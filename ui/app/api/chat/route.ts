import { createOpenAI } from "@ai-sdk/openai";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  tool,
  type UIMessage,
} from "ai";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { getProviderForModel } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

const DEFAULT_SYSTEM_PROMPT =
  "You are Conflux, a helpful AI assistant. Always respond in English unless the user explicitly asks you to use another language.";

const INTERNAL_API_URL =
  process.env.INTERNAL_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8001";
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET ?? "";

async function callBackendTool(
  name: string,
  args: Record<string, unknown>,
  email: string,
): Promise<unknown> {
  const res = await fetch(`${INTERNAL_API_URL}/v1/tools/${name}/execute`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Secret": INTERNAL_API_SECRET,
      "X-User-Email": email,
    },
    body: JSON.stringify({ args }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    return { error: `Tool execution failed (${res.status}): ${err}` };
  }
  const data = (await res.json()) as { result: unknown };
  return data.result;
}

export async function POST(req: Request) {
  const {
    messages,
    model = "",
    systemPrompt,
  }: { messages: UIMessage[]; model?: string; systemPrompt?: string } =
    await req.json();

  if (!model) {
    return new Response(JSON.stringify({ error: "model is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Look up which provider owns this model.
  const provider = await getProviderForModel(model).catch(() => null);
  if (!provider) {
    console.error(`[chat] no provider found for model: ${model}`);
    return new Response(
      JSON.stringify({ error: `No enabled provider found for model: ${model}` }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }

  const baseUrl = provider.base_url.replace(/\/+$/, "");
  console.log(`[chat] routing model=${model} → ${baseUrl}`);

  // Quick connectivity check before attempting to stream
  try {
    const healthUrl = `${baseUrl}/models`;
    const probe = await fetch(healthUrl, { signal: AbortSignal.timeout(3000) });
    if (!probe.ok && probe.status !== 404) {
      console.warn(`[chat] provider health check got ${probe.status} at ${healthUrl}`);
    }
  } catch (connErr) {
    const errMsg = String(connErr);
    const isRefused = errMsg.includes("ECONNREFUSED") || errMsg.includes("fetch failed") || errMsg.includes("ENOTFOUND");
    console.error(`[chat] provider unreachable: ${baseUrl} — ${errMsg}`);
    if (isRefused) {
      return new Response(
        JSON.stringify({
          error: `LLM provider is offline. Cannot connect to ${baseUrl}. Please check the provider in Admin → Providers.`,
        }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      );
    }
  }

  const openai = createOpenAI({
    baseURL: baseUrl,
    apiKey: provider.api_key ?? "none",
  });

  // Get the user's email for backend tool calls
  const session = await auth().catch(() => null);
  const userEmail = session?.user?.email ?? "";

  const startTime = Date.now();
  let ttft: number | null = null;

  const toolsEnabled = !!INTERNAL_API_SECRET && !!userEmail;

  // Use .chat() to force Chat Completions API (/chat/completions).
  // @ai-sdk/openai v3 defaults to the Responses API (/responses) which
  // llama.cpp, vLLM, and Ollama don't implement — causing text-start to be
  // missing from the stream and the client receiving empty messages.
  const result = streamText({
    model: openai.chat(model),
    system: systemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
    maxOutputTokens: 2048,
    stopWhen: stepCountIs(5),
    ...(toolsEnabled && {
      tools: {
        get_weather: tool({
          description:
            "Get current weather conditions and optionally a 7-day forecast for any location worldwide.",
          inputSchema: z.object({
            location: z
              .string()
              .describe("City, region, or address (e.g. 'Houston, TX', 'London')"),
            units: z
              .enum(["imperial", "metric"])
              .optional()
              .describe("imperial = °F / mph; metric = °C / km/h. Default: imperial"),
            include_forecast: z
              .boolean()
              .optional()
              .describe("Set true to include a 7-day daily forecast"),
          }),
          execute: async (args) => {
            console.log("[chat] executing get_weather for", args.location);
            return callBackendTool("get_weather", args, userEmail);
          },
        }),
        web_search: tool({
          description:
            "Search the web for current information using SearXNG. Returns titles, URLs, and snippets.",
          inputSchema: z.object({
            query: z.string().describe("The search query"),
            num_results: z
              .number()
              .optional()
              .describe("Number of results to return (default 5)"),
          }),
          execute: async (args) => {
            console.log("[chat] executing web_search for", args.query);
            return callBackendTool("web_search", args, userEmail);
          },
        }),
      },
    }),
    onChunk: ({ chunk }) => {
      if (ttft === null && chunk.type === "text-delta") {
        ttft = Date.now() - startTime;
      }
    },
    onError: (err) => {
      console.error("[chat] streamText error:", err);
    },
    onFinish: ({ text, usage, finishReason }) => {
      console.log(`[chat] finished: ${text.length} chars, reason=${finishReason}, tokens=`, usage);
    },
  });

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      writer.merge(result.toUIMessageStream());

      // Await usage (resolves when the LLM finishes all tokens)
      const usage = await result.usage;
      const duration = Date.now() - startTime;

      writer.write({
        type: "message-metadata",
        messageMetadata: {
          metrics: {
            inputTokens: usage.inputTokens ?? 0,
            outputTokens: usage.outputTokens ?? 0,
            totalTokens: (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
            ttft: ttft ?? 0,
            duration,
          },
        },
      });
    },
    onError: (error) => {
      console.error("[chat] stream error:", error);
      const msg = String(error);
      if (msg.includes("ECONNREFUSED") || msg.includes("connect")) {
        return `⚠️ Cannot reach the LLM provider at **${baseUrl}**. The server appears to be offline. An admin can update the provider URL in the Providers settings.`;
      }
      if (msg.includes("AI_RetryError") || msg.includes("Failed after")) {
        return `⚠️ The LLM provider is not responding after multiple retries. Please check that the provider at **${baseUrl}** is running.`;
      }
      return msg;
    },
  });

  return createUIMessageStreamResponse({ stream });
}

