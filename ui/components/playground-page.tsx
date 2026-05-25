"use client";

import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  type FileUIPart,
  type ReasoningUIPart,
  type SourceDocumentUIPart,
  type SourceUrlUIPart,
  type TextUIPart,
  type UIMessage,
} from "ai";
import {
  CopyIcon,
  Loader2Icon,
  MessageSquareIcon,
  MicIcon,
  MicOffIcon,
  RefreshCcwIcon,
  SparklesIcon,
} from "lucide-react";
import { Fragment, useCallback, useState } from "react";
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  Attachments,
} from "@/components/ai-elements/attachments";
import {
  Conversation,
  ConversationContent,
  ConversationDownload,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  type PromptInputMessage,
  PromptInputSelect,
  PromptInputSelectContent,
  PromptInputSelectItem,
  PromptInputSelectTrigger,
  PromptInputSelectValue,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import {
  Source,
  Sources,
  SourcesContent,
  SourcesTrigger,
} from "@/components/ai-elements/sources";
import { Button } from "@/components/ui/button";
import type { ProviderModel } from "@/lib/db";
import { useVoiceRecorder } from "@/hooks/use-voice-recorder";

type ChatMetrics = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  ttft: number;
  duration: number;
};

function MessageMetrics({ metadata }: { metadata?: unknown }) {
  const metrics = (metadata as { metrics?: ChatMetrics } | undefined)?.metrics;
  if (!metrics) return null;

  return (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5 px-1 pb-1 pt-0.5 text-[11px] text-muted-foreground/60">
      <span title="Input tokens">↑ {metrics.inputTokens} in</span>
      <span title="Output tokens">↓ {metrics.outputTokens} out</span>
      <span title="Total tokens">∑ {metrics.totalTokens} total</span>
      {metrics.ttft > 0 && (
        <span title="Time to first token">⚡ {metrics.ttft}ms TTFT</span>
      )}
      <span title="Total time">⏱ {metrics.duration}ms</span>
    </div>
  );
}

const isAttachmentPart = (
  part: UIMessage["parts"][number],
): part is FileUIPart | SourceDocumentUIPart =>
  part.type === "file" || part.type === "source-document";

const isReasoningPart = (
  part: UIMessage["parts"][number],
): part is ReasoningUIPart => part.type === "reasoning";

const isSourceUrlPart = (
  part: UIMessage["parts"][number],
): part is SourceUrlUIPart => part.type === "source-url";

const isTextPart = (part: UIMessage["parts"][number]): part is TextUIPart =>
  part.type === "text";

function MessageParts({
  message,
  isLastMessage,
  isStreaming,
}: {
  message: UIMessage;
  isLastMessage: boolean;
  isStreaming: boolean;
}) {
  const reasoningParts = message.parts.filter(isReasoningPart);
  const reasoningText = reasoningParts.map((part) => part.text).join("\n\n");
  const hasReasoning = reasoningParts.length > 0;
  const lastPart = message.parts.at(-1);
  const isReasoningStreaming =
    isLastMessage && isStreaming && lastPart?.type === "reasoning";
  const sourceParts = message.parts.filter(isSourceUrlPart);
  const attachmentParts = message.parts.filter(isAttachmentPart);
  const textParts = message.parts.filter(isTextPart);

  return (
    <>
      {attachmentParts.length > 0 && (
        <Attachments variant="inline">
          {attachmentParts.map((part, index) => (
            <Attachment
              key={`${message.id}-attachment-${index}`}
              data={{
                ...part,
                id: `${message.id}-attachment-${index}`,
              }}
            >
              <AttachmentPreview />
              <AttachmentInfo />
            </Attachment>
          ))}
        </Attachments>
      )}
      {sourceParts.length > 0 && (
        <Sources>
          <SourcesTrigger count={sourceParts.length} />
          <SourcesContent>
            {sourceParts.map((part, index) => (
              <Source
                key={`${message.id}-source-${index}`}
                href={part.url}
                title={part.title ?? part.url}
              />
            ))}
          </SourcesContent>
        </Sources>
      )}
      {hasReasoning && (
        <Reasoning isStreaming={isReasoningStreaming}>
          <ReasoningTrigger />
          <ReasoningContent>{reasoningText}</ReasoningContent>
        </Reasoning>
      )}
      {textParts.map((part, index) => (
        <MessageResponse key={`${message.id}-${index}`}>
          {part.text}
        </MessageResponse>
      ))}
    </>
  );
}

const DEFAULT_SYSTEM_PROMPT =
  "You are Conflux, a helpful AI assistant. Always respond in English unless the user explicitly asks you to use another language.";

export function PlaygroundPage({ models }: { models: ProviderModel[] }) {
  const firstModel = models[0]?.model_name ?? "";
  const [input, setInput] = useState("");
  const [model, setModel] = useState(firstModel);
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const [showSystem, setShowSystem] = useState(false);

  const { messages, regenerate, sendMessage, status, stop } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });

  const isStreaming = status === "submitted" || status === "streaming";

  const handleTranscript = useCallback(
    (text: string) => {
      setInput((prev) => (prev ? `${prev} ${text}` : text));
    },
    [],
  );

  const voice = useVoiceRecorder({ onTranscript: handleTranscript });

  const handleSubmit = (message: PromptInputMessage) => {
    if (!message.text.trim() && message.files.length === 0) {
      return;
    }

    if (message.text.trim()) {
      void sendMessage(
        message.files.length > 0
          ? { text: message.text, files: message.files }
          : { text: message.text },
        { body: { model, systemPrompt } },
      );
    } else {
      void sendMessage({ files: message.files }, { body: { model, systemPrompt } });
    }

    setInput("");
  };

  const VoiceIcon =
    voice.state === "recording"
      ? MicOffIcon
      : voice.state === "transcribing"
        ? Loader2Icon
        : MicIcon;

  return (
    <div className="mx-auto flex h-[calc(100vh-4rem)] max-w-4xl flex-col gap-4 px-4 py-6">
      <div className="flex items-center gap-2">
        <SparklesIcon className="size-5 text-primary" />
        <h1 className="text-xl font-semibold">Playground</h1>
      </div>

      {/* System prompt collapsible panel */}
      <div className="rounded-lg border bg-muted/40">
        <button
          className="flex w-full items-center gap-2 px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
          onClick={() => setShowSystem((v) => !v)}
          type="button"
        >
          <span className="flex-1 text-left">System Prompt</span>
          <span className="text-xs">{showSystem ? "▲" : "▼"}</span>
        </button>
        {showSystem && (
          <div className="border-t px-3 pb-3 pt-2">
            <textarea
              className="w-full resize-none rounded border bg-background px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring"
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="System prompt…"
              rows={4}
              value={systemPrompt}
            />
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col overflow-hidden rounded-lg border bg-card">
        <Conversation>
          <ConversationContent>
            {messages.length === 0 ? (
              <ConversationEmptyState
                description="Select a model and start a conversation with your agent colony."
                icon={
                  <MessageSquareIcon className="size-12 text-muted-foreground" />
                }
                title="Chat with Conflux"
              />
            ) : (
              messages.map((message, index) => {
                const isLastMessage = index === messages.length - 1;

                return (
                  <Fragment key={message.id}>
                    <Message from={message.role}>
                      <MessageContent>
                        <MessageParts
                          isLastMessage={isLastMessage}
                          isStreaming={isStreaming}
                          message={message}
                        />
                      </MessageContent>
                      {message.role === "assistant" && (
                        <MessageMetrics metadata={message.metadata} />
                      )}
                    </Message>
                    {message.role === "assistant" &&
                      isLastMessage &&
                      !isStreaming && (
                        <MessageActions>
                          <MessageAction
                            label="Regenerate"
                            onClick={() => regenerate({ body: { model, systemPrompt } })}
                          >
                            <RefreshCcwIcon className="size-3" />
                          </MessageAction>
                          <MessageAction
                            label="Copy"
                            onClick={() => {
                              const text = message.parts
                                .filter(isTextPart)
                                .map((part) => part.text)
                                .join("");
                              void navigator.clipboard.writeText(text);
                            }}
                          >
                            <CopyIcon className="size-3" />
                          </MessageAction>
                        </MessageActions>
                      )}
                  </Fragment>
                );
              })
            )}
          </ConversationContent>
          <ConversationDownload messages={messages} />
          <ConversationScrollButton />
        </Conversation>
      </div>

      <PromptInput className="w-full" onSubmit={handleSubmit}>
        <PromptInputBody>
          <PromptInputTextarea
            onChange={(event) => setInput(event.currentTarget.value)}
            placeholder="Message Conflux..."
            value={input}
          />
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputTools>
            {models.length > 0 ? (
              <PromptInputSelect onValueChange={setModel} value={model}>
                <PromptInputSelectTrigger>
                  <PromptInputSelectValue />
                </PromptInputSelectTrigger>
                <PromptInputSelectContent>
                  {models.map((m) => (
                    <PromptInputSelectItem key={m.model_name} value={m.model_name}>
                      {m.display_name} ({m.provider_name})
                    </PromptInputSelectItem>
                  ))}
                </PromptInputSelectContent>
              </PromptInputSelect>
            ) : (
              <span className="text-sm text-muted-foreground">
                No models configured — add a provider in Admin.
              </span>
            )}
            <Button
              className={`size-8 shrink-0 ${voice.state === "recording" ? "text-red-500 hover:text-red-600" : voice.state === "error" ? "text-destructive" : "text-muted-foreground hover:text-foreground"}`}
              disabled={voice.state === "transcribing"}
              onClick={voice.toggle}
              size="icon"
              title={
                voice.state === "recording"
                  ? "Stop recording"
                  : voice.state === "transcribing"
                    ? "Transcribing…"
                    : "Record voice input"
              }
              type="button"
              variant="ghost"
            >
              <VoiceIcon
                className={`size-4 ${voice.state === "transcribing" ? "animate-spin" : voice.state === "recording" ? "animate-pulse" : ""}`}
              />
            </Button>
          </PromptInputTools>
          <PromptInputSubmit
            disabled={!input.trim() && !isStreaming}
            onStop={stop}
            status={status}
          />
        </PromptInputFooter>
      </PromptInput>
    </div>
  );
}
