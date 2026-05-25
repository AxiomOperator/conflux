"use client";

import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Edit3,
  ExternalLink as ExternalLinkIcon,
  FileText,
  History,
  Link as LinkIcon,
  Loader2,
  Share2,
  Tag,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  apiRequest,
  type WikiPageDetail,
  type WikiPageTreeNode,
  type WikiPageVersion,
  type WikiSpace,
} from "@/lib/api";
import { formatDate, formatDateTime, formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown) {
  return typeof value === "number" ? value : undefined;
}

type PageLink = NonNullable<WikiPageDetail["sources"]>[number];
type InternalPageLink = NonNullable<WikiPageDetail["internal_links"]>[number];

function normalizeNamedLinks(payload: unknown): PageLink[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload.flatMap((raw) => {
    const value = isRecord(raw) ? raw : {};
    const url = asString(value.url);
    if (!url) {
      return [];
    }

    return [{
      title: asString(value.title, url),
      url,
    } satisfies PageLink];
  });
}

function normalizeInternalLinks(payload: unknown): InternalPageLink[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload.flatMap((raw) => {
    const value = isRecord(raw) ? raw : {};
    const pageId = asString(value.page_id);
    if (!pageId) {
      return [];
    }

    return [{
      page_id: pageId,
      title: asString(value.title, "Untitled page"),
    } satisfies InternalPageLink];
  });
}

function normalizeTags(payload: unknown) {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload.flatMap((tag) => {
    if (typeof tag !== "string") {
      return [];
    }

    const value = tag.trim();
    return value ? [value] : [];
  });
}

function normalizeSpaces(payload: unknown): WikiSpace[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload.map((raw) => {
    const value = isRecord(raw) ? raw : {};
    return {
      default_access: asString(value.default_access) || null,
      description: asString(value.description) || null,
      icon: asString(value.icon) || null,
      id: asString(value.id),
      name: asString(value.name, "Untitled space"),
      page_count: asNumber(value.page_count),
      slug: asString(value.slug),
    } satisfies WikiSpace;
  });
}

function normalizeTree(payload: unknown): WikiPageTreeNode[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload.map((raw) => {
    const value = isRecord(raw) ? raw : {};
    return {
      children: normalizeTree(value.children),
      id: asString(value.id),
      parent_page_id: asString(value.parent_page_id) || null,
      position: asNumber(value.position) ?? 0,
      slug: asString(value.slug),
      title: asString(value.title, "Untitled page"),
    } satisfies WikiPageTreeNode;
  });
}

function normalizePage(payload: unknown): WikiPageDetail {
  const value = isRecord(payload) ? payload : {};
  return {
    content_markdown: asString(value.content_markdown),
    created_by_display_name: asString(value.created_by_display_name) || null,
    external_links: normalizeNamedLinks(value.external_links),
    id: asString(value.id),
    internal_links: normalizeInternalLinks(value.internal_links),
    parent_page_id: asString(value.parent_page_id) || null,
    slug: asString(value.slug),
    sources: normalizeNamedLinks(value.sources),
    space_id: asString(value.space_id),
    tags: normalizeTags(value.tags),
    title: asString(value.title, "Untitled page"),
    updated_at: asString(value.updated_at) || null,
    updated_by_display_name: asString(value.updated_by_display_name) || null,
  } satisfies WikiPageDetail;
}

function normalizeVersions(payload: unknown): WikiPageVersion[] {
  const list = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.versions)
      ? payload.versions
      : [];

  return list.map((raw) => {
    const value = isRecord(raw) ? raw : {};
    const createdByName =
      asString(value.created_by_name) ||
      asString(value.created_by_display_name) ||
      asString(value.created_by);

    return {
      created_at: asString(value.created_at) || null,
      created_by: asString(value.created_by) || null,
      created_by_email: asString(value.created_by_email) || null,
      created_by_name: createdByName || null,
      id: asString(value.id),
      page_id: asString(value.page_id) || null,
      summary: asString(value.summary) || null,
      version_number: asNumber(value.version_number) ?? null,
    } satisfies WikiPageVersion;
  });
}

function flattenTree(nodes: WikiPageTreeNode[]): WikiPageTreeNode[] {
  return nodes.flatMap((node) => [node, ...flattenTree(node.children)]);
}

function findFirstPageId(nodes: WikiPageTreeNode[]): string | null {
  for (const node of nodes) {
    if (node.id) {
      return node.id;
    }
    const childId = findFirstPageId(node.children);
    if (childId) {
      return childId;
    }
  }
  return null;
}

function buildNodeMap(nodes: WikiPageTreeNode[]) {
  return new Map(flattenTree(nodes).map((node) => [node.id, node]));
}

function expandForSelection(
  current: Record<string, boolean>,
  tree: WikiPageTreeNode[],
  selectedId: string | null,
) {
  const next = { ...current };
  for (const node of tree) {
    if (node.children.length > 0 && next[node.id] === undefined) {
      next[node.id] = true;
    }
  }

  if (!selectedId) {
    return next;
  }

  const nodeMap = buildNodeMap(tree);
  let parentId = nodeMap.get(selectedId)?.parent_page_id ?? null;
  while (parentId) {
    next[parentId] = true;
    parentId = nodeMap.get(parentId)?.parent_page_id ?? null;
  }
  return next;
}

function versionTitle(version: WikiPageVersion, index: number) {
  if (typeof version.version_number === "number") {
    return `v${version.version_number}`;
  }
  if (version.id) {
    return `Version ${version.id.slice(0, 8)}`;
  }
  return `Revision ${index + 1}`;
}

function versionAuthorLabel(version: WikiPageVersion) {
  const author =
    version.created_by_name ?? version.created_by_email ?? version.created_by;

  if (author) {
    return `by ${author}`;
  }

  return version.version_number === 1 ? "(initial)" : "by Unknown";
}

function MarkdownBody({ content }: { content: string }) {
  return (
    <pre className="whitespace-pre-wrap break-words rounded-lg bg-muted/50 p-4 text-sm leading-6">
      {content}
    </pre>
  );
}

type TreeItemProps = {
  node: WikiPageTreeNode;
  onSelect: (pageId: string) => void;
  openNodes: Record<string, boolean>;
  selectedPageId: string | null;
  setOpenNodes: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  depth?: number;
};

function TreeItem({
  node,
  onSelect,
  openNodes,
  selectedPageId,
  setOpenNodes,
  depth = 0,
}: TreeItemProps) {
  const hasChildren = node.children.length > 0;
  const isOpen = openNodes[node.id] ?? depth === 0;

  return (
    <div className="space-y-1">
      <div
        className="flex items-center gap-1"
        style={{ paddingLeft: `${depth * 12}px` }}
      >
        {hasChildren ? (
          <Collapsible
            open={isOpen}
            onOpenChange={(open) =>
              setOpenNodes((current) => ({ ...current, [node.id]: open }))
            }
          >
            <div className="flex items-center gap-1">
              <CollapsibleTrigger asChild>
                <Button size="icon-xs" variant="ghost">
                  <ChevronRight
                    className={cn(
                      "size-3 transition-transform",
                      isOpen && "rotate-90",
                    )}
                  />
                </Button>
              </CollapsibleTrigger>
              <button
                className={cn(
                  "flex-1 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted",
                  selectedPageId === node.id &&
                    "bg-secondary font-medium text-foreground",
                )}
                onClick={() => onSelect(node.id)}
                type="button"
              >
                {node.title}
              </button>
            </div>
            <CollapsibleContent className="space-y-1 pt-1">
              {node.children.map((child) => (
                <TreeItem
                  key={child.id}
                  depth={depth + 1}
                  node={child}
                  onSelect={onSelect}
                  openNodes={openNodes}
                  selectedPageId={selectedPageId}
                  setOpenNodes={setOpenNodes}
                />
              ))}
            </CollapsibleContent>
          </Collapsible>
        ) : (
          <>
            <span className="size-6 shrink-0" />
            <button
              className={cn(
                "flex-1 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted",
                selectedPageId === node.id &&
                  "bg-secondary font-medium text-foreground",
              )}
              onClick={() => onSelect(node.id)}
              type="button"
            >
              {node.title}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function WikiSpaceView({
  pageId,
  spaceSlug,
}: {
  pageId?: string;
  spaceSlug?: string;
}) {
  const router = useRouter();
  const [space, setSpace] = useState<WikiSpace | null>(null);
  const [tree, setTree] = useState<WikiPageTreeNode[]>([]);
  const [page, setPage] = useState<WikiPageDetail | null>(null);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(
    pageId ?? null,
  );
  const [openNodes, setOpenNodes] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [pageLoading, setPageLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionsError, setVersionsError] = useState<string | null>(null);
  const [versions, setVersions] = useState<WikiPageVersion[]>([]);
  const [shareCopied, setShareCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!spaceSlug && !pageId) {
        setError("Missing wiki location.");
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const spacesPromise = apiRequest<unknown>("/api/wiki/spaces");
        const pagePromise = pageId
          ? apiRequest<unknown>(`/api/wiki/pages/${pageId}`)
          : Promise.resolve(null);
        const [spacesPayload, currentPagePayload] = await Promise.all([
          spacesPromise,
          pagePromise,
        ]);

        const spaces = normalizeSpaces(spacesPayload);
        let currentPage = currentPagePayload
          ? normalizePage(currentPagePayload)
          : null;
        const currentSpace = currentPage
          ? (spaces.find(
              (candidate) => candidate.id === currentPage?.space_id,
            ) ?? {
              default_access: null,
              description: null,
              icon: null,
              id: currentPage.space_id,
              name: "Wiki space",
              slug: "",
            })
          : (spaces.find((candidate) => candidate.slug === spaceSlug) ?? null);

        if (!currentSpace) {
          throw new Error("Wiki space not found.");
        }

        const treePayload = await apiRequest<unknown>(
          `/api/wiki/spaces/${currentSpace.id}/pages`,
        );
        const nextTree = normalizeTree(treePayload);

        if (!currentPage) {
          const firstPageId = findFirstPageId(nextTree);
          if (firstPageId) {
            currentPage = normalizePage(
              await apiRequest<unknown>(`/api/wiki/pages/${firstPageId}`),
            );
          }
        }

        if (!cancelled) {
          setSpace(currentSpace);
          setTree(nextTree);
          setVersions([]);
          setVersionsError(null);
          setVersionsOpen(false);
          setPage(currentPage);
          setSelectedPageId(currentPage?.id ?? null);
          setOpenNodes((current) =>
            expandForSelection(current, nextTree, currentPage?.id ?? null),
          );
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Failed to load wiki space.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [pageId, spaceSlug]);

  useEffect(() => {
    if (!shareCopied) {
      return;
    }

    const timeoutId = window.setTimeout(() => setShareCopied(false), 2_000);
    return () => window.clearTimeout(timeoutId);
  }, [shareCopied]);

  const nodeMap = useMemo(() => buildNodeMap(tree), [tree]);
  const breadcrumbs = useMemo(() => {
    if (!page) {
      return [] as WikiPageTreeNode[];
    }

    const items: WikiPageTreeNode[] = [];
    let parentId =
      page.parent_page_id ?? nodeMap.get(page.id)?.parent_page_id ?? null;
    while (parentId) {
      const parent = nodeMap.get(parentId);
      if (!parent) {
        break;
      }
      items.unshift(parent);
      parentId = parent.parent_page_id;
    }
    return items;
  }, [nodeMap, page]);

  const hasMetadata = Boolean(
    page &&
      ((page.tags?.length ?? 0) > 0 ||
        (page.sources?.length ?? 0) > 0 ||
        (page.external_links?.length ?? 0) > 0 ||
        (page.internal_links?.length ?? 0) > 0 ||
        page.updated_at ||
        page.created_by_display_name ||
        page.updated_by_display_name),
  );

  async function handleSelectPage(targetPageId: string) {
    if (!targetPageId || targetPageId === selectedPageId) {
      return;
    }

    if (pageId) {
      router.push(`/wiki/pages/${targetPageId}`);
      return;
    }

    setPageLoading(true);
    setError(null);
    try {
      const nextPage = normalizePage(
        await apiRequest<unknown>(`/api/wiki/pages/${targetPageId}`),
      );
      setVersions([]);
      setVersionsError(null);
      setVersionsOpen(false);
      setPage(nextPage);
      setSelectedPageId(nextPage.id);
      setOpenNodes((current) => expandForSelection(current, tree, nextPage.id));
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Failed to load wiki page.",
      );
    } finally {
      setPageLoading(false);
    }
  }

  async function loadVersions(open: boolean) {
    setVersionsOpen(open);
    if (!open || !page?.id || versionsLoading) {
      return;
    }

    if (versions.length > 0 && !versionsError) {
      return;
    }

    setVersionsLoading(true);
    setVersionsError(null);
    try {
      const payload = await apiRequest<unknown>(
        `/api/wiki/pages/${page.id}/versions`,
      );
      setVersions(normalizeVersions(payload));
    } catch (loadError) {
      setVersionsError(
        loadError instanceof Error
          ? loadError.message
          : "Failed to load page history.",
      );
    } finally {
      setVersionsLoading(false);
    }
  }

  async function handleShare() {
    if (typeof window === "undefined") {
      return;
    }

    try {
      await navigator.clipboard.writeText(window.location.href);
      setShareCopied(true);
    } catch {
      setError("Failed to copy page link.");
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading wiki…
        </CardContent>
      </Card>
    );
  }

  if (error && !space) {
    return (
      <Card>
        <CardContent className="py-10 text-sm text-destructive">
          {error}
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold tracking-tight">
              {space?.name ?? "Wiki"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {space?.description ??
                "Browse pages, page history, and nested wiki content."}
            </p>
            {space && (
              <nav className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                {space.slug ? (
                  <Link
                    className="font-medium text-foreground hover:text-primary"
                    href={`/wiki/spaces/${space.slug}`}
                  >
                    {space.name}
                  </Link>
                ) : (
                  <span className="font-medium text-foreground">
                    {space.name}
                  </span>
                )}
                {breadcrumbs.map((item) => (
                  <span key={item.id} className="contents">
                    <ChevronRight className="size-3.5" />
                    <button
                      className="hover:text-foreground"
                      onClick={() => handleSelectPage(item.id)}
                      type="button"
                    >
                      {item.title}
                    </button>
                  </span>
                ))}
                {page && (
                  <span className="contents">
                    <ChevronRight className="size-3.5" />
                    <span className="text-foreground">{page.title}</span>
                  </span>
                )}
              </nav>
            )}
          </div>

          {page && (
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => void handleShare()} variant="outline">
                <Share2 className="size-4" />
                Share
              </Button>
              {shareCopied && (
                <Badge variant="secondary" className="text-xs font-normal">
                  Link copied!
                </Badge>
              )}
              <Button asChild>
                <Link href={`/wiki/pages/${page.id}/edit`}>
                  <Edit3 className="size-4" />
                  Edit
                </Link>
              </Button>
            </div>
          )}
        </div>

        {error && space ? (
          <Card>
            <CardContent className="py-4 text-sm text-destructive">
              {error}
            </CardContent>
          </Card>
        ) : null}

        <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <BookOpen className="size-4" />
                Page tree
              </CardTitle>
              <CardDescription>
                Browse the nested structure of this wiki space.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {tree.length === 0 ? (
                <div className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                  No pages have been added to this space yet.
                </div>
              ) : (
                <div className="space-y-1">
                  {tree.map((node) => (
                    <TreeItem
                      key={node.id}
                      node={node}
                      onSelect={handleSelectPage}
                      openNodes={openNodes}
                      selectedPageId={selectedPageId}
                      setOpenNodes={setOpenNodes}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="min-h-[480px]">
            <CardHeader className="gap-3 border-b pb-5">
              {page ? (
                <>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-xs font-normal">
                      {space?.name ?? "Wiki"}
                    </Badge>
                    {page.updated_at && (
                      <Badge variant="outline" className="text-xs font-normal">
                        Updated {formatDateTime(page.updated_at)}
                      </Badge>
                    )}
                  </div>
                  <CardTitle className="text-2xl">{page.title}</CardTitle>
                </>
              ) : (
                <>
                  <CardTitle className="text-2xl">Select a page</CardTitle>
                  <CardDescription>
                    Choose a page from the tree to view its content.
                  </CardDescription>
                </>
              )}
            </CardHeader>
            <CardContent className="pt-6">
              {pageLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Loading page content…
                </div>
              ) : page ? (
                <div className="space-y-8">
                  {page.content_markdown.trim() ? (
                    <MarkdownBody content={page.content_markdown} />
                  ) : (
                    <div className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                      This page does not have any content yet.
                    </div>
                  )}

                  {hasMetadata && (
                    <div className="space-y-6 border-t pt-6">
                      {(page.tags?.length ?? 0) > 0 && (
                        <div className="space-y-3">
                          <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-muted-foreground">
                            <Tag className="size-4" />
                            <span>🏷️ Tags</span>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {page.tags?.map((tag) => (
                              <Badge key={tag} variant="secondary">
                                {tag}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      {(page.sources?.length ?? 0) > 0 && (
                        <div className="space-y-3">
                          <h3 className="flex items-center gap-2 text-sm font-medium">
                            <LinkIcon className="size-4 text-muted-foreground" />
                            Sources
                          </h3>
                          <div className="space-y-2">
                            {page.sources?.map((source) => (
                              <a
                                key={`${source.title}-${source.url}`}
                                className="flex items-center gap-2 text-sm text-primary hover:underline"
                                href={source.url}
                                rel="noreferrer"
                                target="_blank"
                              >
                                <ExternalLinkIcon className="size-4" />
                                <span>{source.title}</span>
                              </a>
                            ))}
                          </div>
                        </div>
                      )}

                      {(page.external_links?.length ?? 0) > 0 && (
                        <div className="space-y-3">
                          <h3 className="flex items-center gap-2 text-sm font-medium">
                            <ExternalLinkIcon className="size-4 text-muted-foreground" />
                            External Links
                          </h3>
                          <div className="space-y-2">
                            {page.external_links?.map((link) => (
                              <a
                                key={`${link.title}-${link.url}`}
                                className="flex items-center gap-2 text-sm text-primary hover:underline"
                                href={link.url}
                                rel="noreferrer"
                                target="_blank"
                              >
                                <ExternalLinkIcon className="size-4" />
                                <span>{link.title}</span>
                              </a>
                            ))}
                          </div>
                        </div>
                      )}

                      {(page.internal_links?.length ?? 0) > 0 && (
                        <div className="space-y-3">
                          <h3 className="flex items-center gap-2 text-sm font-medium">
                            <LinkIcon className="size-4 text-muted-foreground" />
                            See Also
                          </h3>
                          <div className="space-y-2">
                            {page.internal_links?.map((link) => (
                              <Link
                                key={`${link.title}-${link.page_id}`}
                                className="flex items-center gap-2 text-sm text-primary hover:underline"
                                href={`/wiki/pages/${link.page_id}`}
                              >
                                <LinkIcon className="size-4" />
                                <span>{link.title}</span>
                              </Link>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="space-y-1 text-sm text-muted-foreground">
                        <p>
                          Last edited by {page.updated_by_display_name ?? "Unknown"} ·{" "}
                          {formatDate(page.updated_at)}
                        </p>
                        {page.created_by_display_name &&
                          page.created_by_display_name !==
                            page.updated_by_display_name && (
                            <p>Created by {page.created_by_display_name}</p>
                          )}
                      </div>
                    </div>
                  )}

                  <Collapsible open={versionsOpen} onOpenChange={loadVersions}>
                    <div className="overflow-hidden rounded-xl border">
                      <CollapsibleTrigger asChild>
                        <Button
                          className="h-auto w-full justify-between rounded-none px-4 py-3"
                          variant="ghost"
                        >
                          <span className="flex items-center gap-2 text-sm font-medium">
                            <History className="size-4" />
                            Version History
                          </span>
                          <ChevronDown
                            className={cn(
                              "size-4 transition-transform",
                              versionsOpen && "rotate-180",
                            )}
                          />
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="border-t px-4 py-4">
                        {versionsLoading ? (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Loader2 className="size-4 animate-spin" />
                            Loading revisions…
                          </div>
                        ) : versionsError ? (
                          <p className="text-sm text-destructive">{versionsError}</p>
                        ) : versions.length === 0 ? (
                          <p className="text-sm text-muted-foreground">
                            No saved versions are available yet.
                          </p>
                        ) : (
                          <div className="space-y-3">
                            {versions.map((version, index) => (
                              <div
                                key={version.id || index}
                                className="rounded-lg border bg-muted/30 px-3 py-2"
                              >
                                <p className="flex flex-wrap items-center gap-2 text-sm">
                                  <span className="font-medium text-foreground">
                                    {versionTitle(version, index)}
                                  </span>
                                  <span className="text-muted-foreground">•</span>
                                  <span className="text-muted-foreground">
                                    {formatRelativeTime(version.created_at)}
                                  </span>
                                  <span className="text-muted-foreground">•</span>
                                  <span className="text-muted-foreground">
                                    {versionAuthorLabel(version)}
                                  </span>
                                </p>
                                {version.summary && (
                                  <p className="mt-2 text-sm text-muted-foreground">
                                    {version.summary}
                                  </p>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </CollapsibleContent>
                    </div>
                  </Collapsible>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3 py-12 text-center text-sm text-muted-foreground">
                  <div className="rounded-full bg-muted p-3">
                    <FileText className="size-6" />
                  </div>
                  <p>No page selected.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
