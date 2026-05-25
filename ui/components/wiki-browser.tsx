"use client";

import { BookOpen, Loader2, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { EmojiIconPicker } from "@/components/emoji-icon-picker";
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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/use-auth";
import {
  apiRequest,
  isEffectiveAdmin,
  type WikiSearchResult,
  type WikiSpace,
} from "@/lib/api";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown) {
  return typeof value === "number" ? value : undefined;
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

function normalizeSearchResults(payload: unknown): WikiSearchResult[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload.map((raw) => {
    const value = isRecord(raw) ? raw : {};
    return {
      id: asString(value.id) || undefined,
      page_id: asString(value.page_id) || undefined,
      snippet:
        asString(value.snippet) ||
        asString(value.excerpt) ||
        asString(value.content_preview) ||
        null,
      space_id: asString(value.space_id) || undefined,
      space_slug: asString(value.space_slug) || undefined,
      title: asString(value.title, "Untitled page"),
    } satisfies WikiSearchResult;
  });
}

function searchResultHref(result: WikiSearchResult) {
  const pageId = result.page_id ?? result.id;
  if (pageId) {
    return `/wiki/pages/${pageId}`;
  }
  if (result.space_slug) {
    return `/wiki/spaces/${result.space_slug}`;
  }
  return "/wiki";
}

function slugify(t: string) {
  return t
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function WikiBrowser() {
  const { user } = useAuth();
  const canManageSpaces = isEffectiveAdmin(user);
  const [spaces, setSpaces] = useState<WikiSpace[]>([]);
  const [spacesLoading, setSpacesLoading] = useState(true);
  const [spacesError, setSpacesError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<WikiSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // New Space dialog state
  const [newSpaceOpen, setNewSpaceOpen] = useState(false);
  const [newSpaceName, setNewSpaceName] = useState("");
  const [newSpaceSlug, setNewSpaceSlug] = useState("");
  const [newSpaceIcon, setNewSpaceIcon] = useState("📚");
  const [newSpaceAccess, setNewSpaceAccess] = useState("private");
  const [newSpaceDesc, setNewSpaceDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadSpaces() {
      setSpacesLoading(true);
      setSpacesError(null);
      try {
        const data = normalizeSpaces(
          await apiRequest<unknown>("/api/wiki/spaces"),
        );
        if (!cancelled) {
          setSpaces(data);
        }
      } catch (error) {
        if (!cancelled) {
          setSpacesError(
            error instanceof Error
              ? error.message
              : "Failed to load wiki spaces.",
          );
        }
      } finally {
        if (!cancelled) {
          setSpacesLoading(false);
        }
      }
    }

    void loadSpaces();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      setResults([]);
      setSearchLoading(false);
      setSearchError(null);
      return;
    }

    let cancelled = false;
    setSearchLoading(true);
    setSearchError(null);

    const timer = window.setTimeout(async () => {
      try {
        const data = normalizeSearchResults(
          await apiRequest<unknown>(
            `/api/wiki/search?q=${encodeURIComponent(trimmedQuery)}`,
          ),
        );
        if (!cancelled) {
          setResults(data);
        }
      } catch (error) {
        if (!cancelled) {
          setResults([]);
          setSearchError(
            error instanceof Error ? error.message : "Wiki search failed.",
          );
        }
      } finally {
        if (!cancelled) {
          setSearchLoading(false);
        }
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  const isSearching = query.trim().length > 0;
  const pageCountLabel = useMemo(
    () => new Intl.PluralRules("en-US", { type: "cardinal" }),
    [],
  );

  const handleCreateSpace = async () => {
    if (!newSpaceName.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/admin/wiki/spaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newSpaceName.trim(),
          slug: newSpaceSlug.trim() || slugify(newSpaceName.trim()),
          description: newSpaceDesc.trim() || null,
          icon: newSpaceIcon || "📚",
          default_access: newSpaceAccess,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setCreateError(
          (err as { detail?: string }).detail ?? "Failed to create space.",
        );
        return;
      }
      const created = (await res.json()) as WikiSpace;
      setSpaces((prev) => [...prev, created]);
      setNewSpaceOpen(false);
      setNewSpaceName("");
      setNewSpaceSlug("");
      setNewSpaceDesc("");
      setNewSpaceIcon("📚");
      setNewSpaceAccess("private");
    } catch {
      setCreateError("Network error — please try again.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* New Space Dialog */}
      <Dialog open={newSpaceOpen} onOpenChange={setNewSpaceOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create New Space</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label htmlFor="space-name">
                Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="space-name"
                value={newSpaceName}
                onChange={(e) => setNewSpaceName(e.target.value)}
                placeholder="e.g. Engineering Docs"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="space-slug">Slug</Label>
              <Input
                id="space-slug"
                value={newSpaceSlug}
                onChange={(e) => setNewSpaceSlug(e.target.value)}
                placeholder="auto-generated from name"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="space-desc">Description</Label>
              <Input
                id="space-desc"
                value={newSpaceDesc}
                onChange={(e) => setNewSpaceDesc(e.target.value)}
                placeholder="Optional"
              />
            </div>
            <div className="flex gap-4">
              <div className="space-y-1">
                <Label>Icon</Label>
                <EmojiIconPicker
                  value={newSpaceIcon}
                  onChange={setNewSpaceIcon}
                />
              </div>
              <div className="flex-1 space-y-1">
                <Label>Default Access</Label>
                <Select
                  value={newSpaceAccess}
                  onValueChange={setNewSpaceAccess}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="private">Private</SelectItem>
                    <SelectItem value="public">Public (read)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {createError && (
              <p className="text-sm text-destructive">{createError}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewSpaceOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateSpace}
              disabled={creating || !newSpaceName.trim()}
            >
              {creating ? (
                <Loader2 className="size-4 animate-spin mr-2" />
              ) : null}
              {creating ? "Creating…" : "Create Space"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Wiki</h1>
          <p className="text-sm text-muted-foreground">
            Browse shared spaces, jump into pages, and search across your
            knowledge base.
          </p>
        </div>
        {canManageSpaces && (
          <Button onClick={() => setNewSpaceOpen(true)}>
            <Plus className="size-4" />
            New Space
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="size-4" />
            Search wiki
          </CardTitle>
          <CardDescription>
            Search page titles and snippets across spaces you can access.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search pages, notes, and documentation"
              value={query}
            />
          </div>

          {isSearching ? (
            <div className="rounded-lg border">
              {searchLoading ? (
                <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Searching wiki pages…
                </div>
              ) : searchError ? (
                <div className="px-4 py-6 text-sm text-destructive">
                  {searchError}
                </div>
              ) : results.length === 0 ? (
                <div className="px-4 py-6 text-sm text-muted-foreground">
                  No wiki pages matched your search.
                </div>
              ) : (
                <div className="divide-y">
                  {results.map((result, index) => (
                    <Link
                      key={`${result.page_id ?? result.id ?? result.title}-${index}`}
                      className="block px-4 py-3 transition-colors hover:bg-muted/40"
                      href={searchResultHref(result)}
                    >
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{result.title}</p>
                        {result.space_slug && (
                          <Badge
                            variant="secondary"
                            className="text-xs font-normal"
                          >
                            {result.space_slug}
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
                        {result.snippet ?? "Open page"}
                      </p>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {spacesError ? (
        <Card>
          <CardContent className="py-10 text-sm text-destructive">
            {spacesError}
          </CardContent>
        </Card>
      ) : spacesLoading ? (
        <Card>
          <CardContent className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading wiki spaces…
          </CardContent>
        </Card>
      ) : spaces.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="rounded-full bg-muted p-3 text-muted-foreground">
              <BookOpen className="size-6" />
            </div>
            <div className="space-y-1">
              <p className="font-medium">No wiki spaces yet</p>
              <p className="text-sm text-muted-foreground">
                Create your first space to share knowledge with the team.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {spaces.map((space) => {
            const count = space.page_count;
            const countLabel =
              typeof count === "number"
                ? `${count} ${pageCountLabel.select(count) === "one" ? "page" : "pages"}`
                : null;

            return (
              <Link key={space.id} href={`/wiki/spaces/${space.slug}`}>
                <Card className="h-full transition-all hover:border-primary/40 hover:shadow-md">
                  <CardHeader className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex size-11 items-center justify-center rounded-full bg-muted text-xl">
                        <span aria-hidden="true">{space.icon ?? "📚"}</span>
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {countLabel && (
                          <Badge
                            variant="secondary"
                            className="text-xs font-normal"
                          >
                            {countLabel}
                          </Badge>
                        )}
                        {space.default_access && (
                          <Badge
                            variant="outline"
                            className="text-xs font-normal"
                          >
                            {space.default_access}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <CardTitle>{space.name}</CardTitle>
                      <CardDescription className="line-clamp-3 min-h-[3.75rem]">
                        {space.description ?? "No description provided."}
                      </CardDescription>
                    </div>
                  </CardHeader>
                </Card>
              </Link>
            );
          })}
        </section>
      )}
    </div>
  );
}
