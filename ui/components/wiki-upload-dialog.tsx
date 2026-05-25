"use client";

import { Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { WikiPageRecord } from "@/components/wiki-editor";

interface WikiUploadDialogProps {
  spaceId: string;
  onUploaded?: (page: WikiPageRecord) => void;
}

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

export function WikiUploadDialog({
  spaceId,
  onUploaded,
}: WikiUploadDialogProps) {
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function resetDialogState() {
    setError(null);
    if (fileRef.current) {
      fileRef.current.value = "";
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen && !uploading) {
      resetDialogState();
    }
  }

  async function handleUpload() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Choose a PDF or Markdown file to upload.");
      return;
    }

    const filename = file.name.toLowerCase();
    if (!filename.endsWith(".pdf") && !filename.endsWith(".md")) {
      setError("Only .pdf and .md files are supported.");
      return;
    }

    setUploading(true);
    setError(null);

    try {
      const form = new FormData();
      form.append("file", file);

      const response = await fetch(`/api/wiki/spaces/${spaceId}/upload`, {
        method: "POST",
        body: form,
      });
      const payload = (await response.json().catch(() => null)) as
        | WikiPageRecord
        | { detail?: string }
        | null;

      if (!response.ok) {
        throw new Error(
          getErrorMessage(
            payload,
            "Upload failed. Check file type and try again.",
          ),
        );
      }

      onUploaded?.((payload ?? { id: "" }) as WikiPageRecord);
      resetDialogState();
      setOpen(false);
    } catch (uploadError) {
      setError(
        uploadError instanceof Error ? uploadError.message : "Upload failed.",
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Upload className="mr-2 size-4" />
          Upload File
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload Document</DialogTitle>
          <DialogDescription>
            Upload a PDF or Markdown file. It will be added as a new wiki page
            and indexed for search.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.md"
            className="text-sm"
          />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="flex gap-2">
            <Button onClick={handleUpload} disabled={uploading}>
              {uploading ? "Uploading..." : "Upload"}
            </Button>
            <Button
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={uploading}
            >
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
