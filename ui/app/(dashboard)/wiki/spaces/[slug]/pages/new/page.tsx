"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";

import { WikiEditor } from "@/components/wiki-editor";

export default function NewWikiPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const parentPageId = searchParams.get("parent") ?? undefined;
  const spaceId = searchParams.get("spaceId") ?? "";

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">New Page</h1>
        {!spaceId ? (
          <p className="mt-2 text-sm text-destructive">
            Missing spaceId for wiki space “{slug}”. Open this form from a wiki
            space page.
          </p>
        ) : null}
      </div>
      <WikiEditor
        spaceId={spaceId}
        parentPageId={parentPageId}
        onSave={(page) => router.push(`/wiki/pages/${page.id}`)}
        onCancel={() => router.back()}
      />
    </div>
  );
}
