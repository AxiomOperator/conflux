"use client";

import { useState, type KeyboardEvent } from "react";
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Link,
  Plus,
  Tag,
  X,
} from "lucide-react";
import { Streamdown } from "streamdown";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

interface WikiLinkItem {
  title: string;
  url: string;
}

interface WikiInternalLinkItem {
  title: string;
  page_id: string;
}

export interface WikiPageRecord {
  id: string;
  space_id?: string;
  title?: string;
  slug?: string;
  content_markdown?: string | null;
  sources?: WikiLinkItem[];
  external_links?: WikiLinkItem[];
  internal_links?: WikiInternalLinkItem[];
  tags?: string[];
  updated_by?: string | null;
  updated_by_display_name?: string | null;
  created_by?: string | null;
  created_by_display_name?: string | null;
  [key: string]: unknown;
}

interface WikiEditorProps {
  spaceId: string;
  initialPage?: WikiPageRecord | null;
  initialTitle?: string;
  initialContent?: string;
  pageId?: string;
  parentPageId?: string;
  onSave?: (page: WikiPageRecord) => void;
  onCancel?: () => void;
}

function slugify(title: string) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
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

export function WikiEditor({
  spaceId,
  initialPage,
  initialTitle = "",
  initialContent = "",
  pageId,
  parentPageId,
  onSave,
  onCancel,
}: WikiEditorProps) {
  const [title, setTitle] = useState(initialPage?.title ?? initialTitle);
  const [content, setContent] = useState(
    initialPage?.content_markdown ?? initialContent,
  );
  const [tags, setTags] = useState<string[]>(initialPage?.tags ?? []);
  const [sources, setSources] = useState<WikiLinkItem[]>(
    initialPage?.sources ?? [],
  );
  const [externalLinks, setExternalLinks] = useState<WikiLinkItem[]>(
    initialPage?.external_links ?? [],
  );
  const [internalLinks, setInternalLinks] = useState<WikiInternalLinkItem[]>(
    initialPage?.internal_links ?? [],
  );
  const [tagInput, setTagInput] = useState("");
  const [sourceTitle, setSourceTitle] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [externalLinkTitle, setExternalLinkTitle] = useState("");
  const [externalLinkUrl, setExternalLinkUrl] = useState("");
  const [internalLinkTitle, setInternalLinkTitle] = useState("");
  const [internalLinkPageId, setInternalLinkPageId] = useState("");
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"write" | "preview">("write");
  const [error, setError] = useState<string | null>(null);
  const [metadataOpen, setMetadataOpen] = useState(false);

  function addTag() {
    const tag = tagInput.trim().replace(/,/g, "");
    if (tag && !tags.includes(tag)) {
      setTags([...tags, tag]);
    }
    setTagInput("");
  }

  function handleTagInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      addTag();
    }
  }

  function addSource() {
    const nextTitle = sourceTitle.trim();
    const nextUrl = sourceUrl.trim();
    if (!nextTitle || !nextUrl) {
      return;
    }

    setSources([...sources, { title: nextTitle, url: nextUrl }]);
    setSourceTitle("");
    setSourceUrl("");
  }

  function addExternalLink() {
    const nextTitle = externalLinkTitle.trim();
    const nextUrl = externalLinkUrl.trim();
    if (!nextTitle || !nextUrl) {
      return;
    }

    setExternalLinks([
      ...externalLinks,
      { title: nextTitle, url: nextUrl },
    ]);
    setExternalLinkTitle("");
    setExternalLinkUrl("");
  }

  function addInternalLink() {
    const nextTitle = internalLinkTitle.trim();
    const nextPageId = internalLinkPageId.trim();
    if (!nextTitle || !nextPageId) {
      return;
    }

    setInternalLinks([
      ...internalLinks,
      { title: nextTitle, page_id: nextPageId },
    ]);
    setInternalLinkTitle("");
    setInternalLinkPageId("");
  }

  async function handleSave() {
    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      setError("A title is required.");
      return;
    }

    if (!pageId && !spaceId.trim()) {
      setError("Missing wiki space context.");
      return;
    }

    const slug = slugify(normalizedTitle);
    if (!pageId && !slug) {
      setError("Title must include at least one letter or number.");
      return;
    }

    setSaving(true);
    setError(null);

    const metadata = {
      sources,
      external_links: externalLinks,
      internal_links: internalLinks,
      tags,
    };

    try {
      const response = await fetch(
        pageId
          ? `/api/wiki/pages/${pageId}`
          : `/api/wiki/spaces/${spaceId}/pages`,
        {
          method: pageId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            pageId
              ? {
                  title: normalizedTitle,
                  content_markdown: content,
                  ...metadata,
                }
              : {
                  title: normalizedTitle,
                  slug,
                  content_markdown: content,
                  ...(parentPageId ? { parent_page_id: parentPageId } : {}),
                  ...metadata,
                },
          ),
        },
      );

      const payload = (await response.json().catch(() => null)) as
        | WikiPageRecord
        | { detail?: string }
        | null;
      if (!response.ok) {
        throw new Error(
          getErrorMessage(payload, `Request failed (${response.status}).`),
        );
      }

      onSave?.((payload ?? { id: pageId ?? "" }) as WikiPageRecord);
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Failed to save page.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-2">
        <Label htmlFor="wiki-page-title">Title</Label>
        <Input
          id="wiki-page-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Page title"
        />
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) =>
          setActiveTab(value === "preview" ? "preview" : "write")
        }
      >
        <TabsList>
          <TabsTrigger value="write">Write</TabsTrigger>
          <TabsTrigger value="preview">Preview</TabsTrigger>
        </TabsList>

        <TabsContent value="write">
          <Textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="Write your page content in Markdown..."
            className="min-h-[400px] font-mono text-sm"
          />
        </TabsContent>

        <TabsContent value="preview">
          <div className="min-h-[400px] rounded-md border p-4 text-sm">
            <div className="prose prose-sm max-w-none dark:prose-invert">
              <Streamdown>{content || "_Nothing to preview yet._"}</Streamdown>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <Collapsible defaultOpen={false} onOpenChange={setMetadataOpen}>
        <div className="rounded-lg border">
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              className="flex h-auto w-full items-center justify-between rounded-lg px-4 py-3"
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                <BookOpen className="size-4" />
                Article Metadata
              </span>
              {metadataOpen ? (
                <ChevronDown className="size-4" />
              ) : (
                <ChevronRight className="size-4" />
              )}
            </Button>
          </CollapsibleTrigger>

          <CollapsibleContent className="border-t px-4 py-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-3 rounded-lg border p-4 lg:col-span-2">
                <div className="flex items-center gap-2">
                  <Tag className="size-4 text-muted-foreground" />
                  <Label htmlFor="wiki-page-tags">Tags</Label>
                </div>
                <Input
                  id="wiki-page-tags"
                  value={tagInput}
                  onChange={(event) => setTagInput(event.target.value)}
                  onKeyDown={handleTagInputKeyDown}
                  placeholder="Type a tag and press Enter or comma"
                />
                <div className="flex flex-wrap gap-2">
                  {tags.length > 0 ? (
                    tags.map((tag) => (
                      <Badge key={tag} variant="outline" className="gap-1 pr-1">
                        {tag}
                        <button
                          type="button"
                          className="rounded-full p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                          onClick={() =>
                            setTags(tags.filter((existingTag) => existingTag !== tag))
                          }
                          aria-label={`Remove tag ${tag}`}
                        >
                          <X className="size-3" />
                        </button>
                      </Badge>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No tags added yet.
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-3 rounded-lg border p-4">
                <div className="flex items-center gap-2">
                  <BookOpen className="size-4 text-muted-foreground" />
                  <Label>Sources</Label>
                </div>
                <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                  <Input
                    value={sourceTitle}
                    onChange={(event) => setSourceTitle(event.target.value)}
                    placeholder="Title"
                  />
                  <Input
                    value={sourceUrl}
                    onChange={(event) => setSourceUrl(event.target.value)}
                    placeholder="URL"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={addSource}
                    disabled={!sourceTitle.trim() || !sourceUrl.trim()}
                  >
                    <Plus className="size-4" />
                    Add
                  </Button>
                </div>
                <div className="space-y-2">
                  {sources.length > 0 ? (
                    sources.map((source, index) => (
                      <div
                        key={`${source.title}-${source.url}-${index}`}
                        className="flex items-start justify-between gap-3 rounded-md border p-3"
                      >
                        <div className="min-w-0 space-y-1">
                          <p className="text-sm font-medium">{source.title}</p>
                          <a
                            href={source.url}
                            target="_blank"
                            rel="noreferrer"
                            className="block truncate text-sm text-muted-foreground hover:text-foreground hover:underline"
                          >
                            {source.url}
                          </a>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() =>
                            setSources(sources.filter((_, itemIndex) => itemIndex !== index))
                          }
                          aria-label={`Remove source ${source.title}`}
                        >
                          <X className="size-4" />
                        </Button>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No sources added yet.
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-3 rounded-lg border p-4">
                <div className="flex items-center gap-2">
                  <Link className="size-4 text-muted-foreground" />
                  <Label>External Links</Label>
                </div>
                <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                  <Input
                    value={externalLinkTitle}
                    onChange={(event) => setExternalLinkTitle(event.target.value)}
                    placeholder="Title"
                  />
                  <Input
                    value={externalLinkUrl}
                    onChange={(event) => setExternalLinkUrl(event.target.value)}
                    placeholder="URL"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={addExternalLink}
                    disabled={
                      !externalLinkTitle.trim() || !externalLinkUrl.trim()
                    }
                  >
                    <Plus className="size-4" />
                    Add
                  </Button>
                </div>
                <div className="space-y-2">
                  {externalLinks.length > 0 ? (
                    externalLinks.map((linkItem, index) => (
                      <div
                        key={`${linkItem.title}-${linkItem.url}-${index}`}
                        className="flex items-start justify-between gap-3 rounded-md border p-3"
                      >
                        <div className="min-w-0 space-y-1">
                          <p className="text-sm font-medium">{linkItem.title}</p>
                          <a
                            href={linkItem.url}
                            target="_blank"
                            rel="noreferrer"
                            className="block truncate text-sm text-muted-foreground hover:text-foreground hover:underline"
                          >
                            {linkItem.url}
                          </a>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() =>
                            setExternalLinks(
                              externalLinks.filter(
                                (_, itemIndex) => itemIndex !== index,
                              ),
                            )
                          }
                          aria-label={`Remove external link ${linkItem.title}`}
                        >
                          <X className="size-4" />
                        </Button>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No external links added yet.
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-3 rounded-lg border p-4 lg:col-span-2">
                <div className="flex items-center gap-2">
                  <Link className="size-4 text-muted-foreground" />
                  <Label>Internal Links</Label>
                </div>
                <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                  <Input
                    value={internalLinkTitle}
                    onChange={(event) => setInternalLinkTitle(event.target.value)}
                    placeholder="Title"
                  />
                  <Input
                    value={internalLinkPageId}
                    onChange={(event) => setInternalLinkPageId(event.target.value)}
                    placeholder="Page ID/URL"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={addInternalLink}
                    disabled={
                      !internalLinkTitle.trim() || !internalLinkPageId.trim()
                    }
                  >
                    <Plus className="size-4" />
                    Add
                  </Button>
                </div>
                <div className="space-y-2">
                  {internalLinks.length > 0 ? (
                    internalLinks.map((linkItem, index) => (
                      <div
                        key={`${linkItem.title}-${linkItem.page_id}-${index}`}
                        className="flex items-start justify-between gap-3 rounded-md border p-3"
                      >
                        <div className="min-w-0 space-y-1">
                          <p className="text-sm font-medium">{linkItem.title}</p>
                          <p className="truncate text-sm text-muted-foreground">
                            {linkItem.page_id}
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() =>
                            setInternalLinks(
                              internalLinks.filter(
                                (_, itemIndex) => itemIndex !== index,
                              ),
                            )
                          }
                          aria-label={`Remove internal link ${linkItem.title}`}
                        >
                          <X className="size-4" />
                        </Button>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No internal links added yet.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex gap-2">
        <Button
          onClick={handleSave}
          disabled={saving || !title.trim() || (!pageId && !spaceId.trim())}
        >
          {saving ? "Saving..." : pageId ? "Update Page" : "Create Page"}
        </Button>
        {onCancel ? (
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </div>
  );
}
