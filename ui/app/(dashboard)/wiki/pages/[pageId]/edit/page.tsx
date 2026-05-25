"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { WikiEditor, type WikiPageRecord } from "@/components/wiki-editor";

function getErrorMessage(payload: unknown, fallback: string) {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "detail" in payload &&
    typeof payload.detail === "string"
  ) {
    return payload.detail;
  }

  return fallback;
}

export default function EditWikiPage() {
  const { pageId } = useParams<{ pageId: string }>();
  const router = useRouter();
  const [page, setPage] = useState<WikiPageRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadPage() {
      setError(null);

      try {
        const response = await fetch(`/api/wiki/pages/${pageId}`, {
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => null)) as
          | WikiPageRecord
          | { detail?: string }
          | null;

        if (!response.ok) {
          throw new Error(getErrorMessage(payload, "Failed to load page."));
        }

        if (!cancelled) {
          setPage((payload ?? null) as WikiPageRecord | null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Failed to load page.",
          );
        }
      }
    }

    void loadPage();

    return () => {
      cancelled = true;
    };
  }, [pageId]);

  if (error) {
    return <div className="p-6 text-sm text-destructive">{error}</div>;
  }

  if (!page) {
    return <div className="p-6">Loading...</div>;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <h1 className="text-2xl font-bold">Edit Page</h1>
      <WikiEditor
        spaceId={page.space_id ?? ""}
        initialPage={page}
        pageId={pageId}
        initialTitle={page.title ?? ""}
        initialContent={page.content_markdown ?? ""}
        onSave={() => router.push(`/wiki/pages/${pageId}`)}
        onCancel={() => router.back()}
      />
    </div>
  );
}
