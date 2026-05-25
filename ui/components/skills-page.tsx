"use client";

import { BookOpen, Download, ExternalLink, Loader2, Plus, Search, Star, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useMemo, useRef, useState } from "react";

import { DataTable, type DataTableColumn } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  createApiClient,
  type MarketplaceSkill,
  type Skill,
  type SkillCreateInput,
} from "@/lib/api";
import { formatDateTime } from "@/lib/format";

function isPending(status: string) {
  return (
    status === "draft" || status === "pending_review" || status === "pending"
  );
}

const DEFAULT_CONTENT = `## When to Use

Describe when an agent should apply this skill.

## Procedure

1. Step one
2. Step two
3. Step three

## Pitfalls

- Common mistakes to avoid.

## Verification

How to confirm the skill was applied correctly.
`.trim();

function CreateSkillDialog({
  onClose,
  onCreated,
  token,
}: {
  onClose: () => void;
  onCreated: () => void;
  token: string;
}) {
  const [form, setForm] = useState<SkillCreateInput>({
    auto_approve: false,
    category: "",
    content: DEFAULT_CONTENT,
    description: "",
    is_global: false,
    name: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!form.name.trim() || !form.description.trim() || !form.content.trim()) {
      setError("Name, description, and content are required.");
      return;
    }
    try {
      setSaving(true);
      setError(null);
      await createApiClient(token).skills.create({
        ...form,
        category: form.category?.trim() || undefined,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create skill.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Skill</DialogTitle>
          <DialogDescription>
            Manually author a skill that agents can reference. Skills can also be auto-drafted by the reflection system after complex runs.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="skill-name">Name <span className="text-destructive">*</span></Label>
              <Input
                id="skill-name"
                placeholder="e.g. Weather Lookup"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="skill-category">Category</Label>
              <Input
                id="skill-category"
                placeholder="e.g. tools, research, data"
                value={form.category ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="skill-description">Description <span className="text-destructive">*</span></Label>
            <Input
              id="skill-description"
              placeholder="What this skill does in one sentence"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="skill-content">Content (Markdown) <span className="text-destructive">*</span></Label>
            <Textarea
              id="skill-content"
              className="font-mono text-xs min-h-[240px]"
              value={form.content}
              onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
            />
          </div>

          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <Checkbox
                id="skill-global"
                checked={form.is_global}
                onCheckedChange={(v) => setForm((f) => ({ ...f, is_global: !!v }))}
              />
              <Label htmlFor="skill-global" className="cursor-pointer">Global (all tenants)</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="skill-approve"
                checked={form.auto_approve}
                onCheckedChange={(v) => setForm((f) => ({ ...f, auto_approve: !!v }))}
              />
              <Label htmlFor="skill-approve" className="cursor-pointer">Approve immediately</Label>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
            Create Skill
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MarketplaceTab({ isAdmin, token }: { isAdmin: boolean; token: string }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<MarketplaceSkill[] | null>(null);
  const [pagination, setPagination] = useState<{ total: number; totalPages: number } | null>(null);
  const [page, setPage] = useState(1);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [importedIds, setImportedIds] = useState<Set<string>>(new Set());
  const [importError, setImportError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  async function doSearch(q: string, p = 1) {
    if (!q.trim()) return;
    setLoading(true);
    setImportError(null);
    try {
      const data = await createApiClient(token).skills.marketplaceSearch(q.trim(), { page: p, limit: 20 });
      setResults(data.skills);
      setPagination(data.pagination);
      setPage(p);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleImport(skill: MarketplaceSkill) {
    if (!isAdmin) return;
    setImportingId(skill.id);
    setImportError(null);
    try {
      await createApiClient(token).skills.marketplaceImport(skill);
      setImportedIds((s) => new Set([...s, skill.id]));
      router.refresh();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImportingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            ref={searchRef}
            className="pl-9"
            placeholder="Search the SkillsMP marketplace… e.g. weather, data analysis"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doSearch(query)}
          />
        </div>
        <Button onClick={() => doSearch(query)} disabled={loading || !query.trim()}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : "Search"}
        </Button>
      </div>

      {importError && (
        <p className="text-sm text-destructive">{importError}</p>
      )}

      {results === null && !loading && (
        <div className="flex flex-col items-center gap-4 py-16 text-center">
          <div className="rounded-full bg-muted p-4">
            <Search className="size-8 text-muted-foreground" />
          </div>
          <div className="max-w-sm space-y-1">
            <p className="font-medium">Search the SkillsMP marketplace</p>
            <p className="text-sm text-muted-foreground">
              Discover community-published skills and import them into your Conflux instance for agent use.
            </p>
          </div>
        </div>
      )}

      {results !== null && results.length === 0 && (
        <p className="text-center text-sm text-muted-foreground py-8">No skills found for "{query}".</p>
      )}

      {results && results.length > 0 && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {results.map((skill) => {
              const imported = importedIds.has(skill.id);
              const importing = importingId === skill.id;
              return (
                <Card key={skill.id} className="flex flex-col">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-base leading-tight">{skill.name}</CardTitle>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                        <Star className="size-3 fill-yellow-400 text-yellow-400" />
                        {skill.stars.toLocaleString()}
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">by {skill.author}</p>
                  </CardHeader>
                  <CardContent className="flex-1 flex flex-col gap-3 pt-0">
                    <p className="text-sm text-muted-foreground line-clamp-3">
                      {skill.description}
                    </p>
                    <div className="mt-auto flex items-center gap-2">
                      {isAdmin ? (
                        <Button
                          size="sm"
                          className="flex-1"
                          disabled={importing || imported}
                          variant={imported ? "secondary" : "default"}
                          onClick={() => handleImport(skill)}
                        >
                          {importing ? (
                            <Loader2 className="size-3 animate-spin mr-1.5" />
                          ) : imported ? (
                            <Download className="size-3 mr-1.5" />
                          ) : (
                            <Download className="size-3 mr-1.5" />
                          )}
                          {imported ? "Imported" : "Import"}
                        </Button>
                      ) : (
                        <Badge variant="secondary" className="text-xs">Admin only</Badge>
                      )}
                      <Button size="sm" variant="outline" asChild>
                        <a href={skill.skillUrl} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="size-3" />
                        </a>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {pagination && pagination.totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-2">
              <Button
                size="sm"
                variant="outline"
                disabled={page <= 1 || loading}
                onClick={() => doSearch(query, page - 1)}
              >
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {page} of {pagination.totalPages} ({pagination.total.toLocaleString()} results)
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={page >= pagination.totalPages || loading}
                onClick={() => doSearch(query, page + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function SkillsPage({
  isAdmin,
  skills,
}: {
  isAdmin: boolean;
  skills: Skill[];
}) {
  const router = useRouter();
  const { data: session } = useSession();
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const columns = useMemo<DataTableColumn<Skill>[]>(
    () => [
      {
        header: "Name",
        key: "name",
        render: (skill) => (
          <div>
            <p className="font-medium">{skill.name}</p>
            <p className="text-sm text-muted-foreground">
              {skill.description || skill.slug}
            </p>
          </div>
        ),
        sortable: true,
        sortValue: (skill) => skill.name,
      },
      {
        header: "Category",
        key: "category",
        render: (skill) => skill.category ?? <span className="text-muted-foreground">—</span>,
      },
      {
        header: "Version",
        key: "version",
        render: (skill) => skill.version,
        sortable: true,
        sortValue: (skill) => skill.version,
      },
      {
        header: "Status",
        key: "approval_status",
        render: (skill) => <StatusBadge status={skill.approval_status} />,
        sortable: true,
        sortValue: (skill) => skill.approval_status,
      },
      {
        header: "Created",
        key: "created_at",
        render: (skill) => formatDateTime(skill.created_at),
        sortable: true,
        sortValue: (skill) => skill.created_at,
      },
      {
        className: "w-[220px]",
        header: "Actions",
        key: "actions",
        render: (skill) =>
          isAdmin && isPending(skill.approval_status) ? (
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={workingId === skill.id}
                onClick={async (event) => {
                  event.stopPropagation();
                  if (!session?.accessToken) {
                    setError("No active session token was found.");
                    return;
                  }
                  try {
                    setError(null);
                    setWorkingId(skill.id);
                    await createApiClient(session.accessToken).skills.approve(skill.id);
                    router.refresh();
                  } catch (approveError) {
                    setError(approveError instanceof Error ? approveError.message : "Failed to approve skill.");
                  } finally {
                    setWorkingId(null);
                  }
                }}
              >
                {workingId === skill.id ? <Loader2 className="size-4 animate-spin" /> : null}
                Approve
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={workingId === skill.id}
                onClick={async (event) => {
                  event.stopPropagation();
                  if (!session?.accessToken) {
                    setError("No active session token was found.");
                    return;
                  }
                  try {
                    setError(null);
                    setWorkingId(skill.id);
                    await createApiClient(session.accessToken).skills.reject(skill.id);
                    router.refresh();
                  } catch (rejectError) {
                    setError(rejectError instanceof Error ? rejectError.message : "Failed to reject skill.");
                  } finally {
                    setWorkingId(null);
                  }
                }}
              >
                Reject
              </Button>
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">No actions</span>
          ),
      },
    ],
    [isAdmin, router, session?.accessToken, workingId],
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Skills</h1>
          <p className="text-sm text-muted-foreground">
            Manage your skill catalog and discover new skills from the marketplace.
          </p>
        </div>
        {isAdmin && session?.accessToken && (
          <Button onClick={() => setShowCreate(true)} className="shrink-0">
            <Plus className="size-4 mr-2" />
            New Skill
          </Button>
        )}
      </div>

      {showCreate && session?.accessToken && (
        <CreateSkillDialog
          token={session.accessToken}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            router.refresh();
          }}
        />
      )}

      <Tabs defaultValue="catalog">
        <TabsList>
          <TabsTrigger value="catalog">Catalog</TabsTrigger>
          <TabsTrigger value="marketplace">Marketplace</TabsTrigger>
        </TabsList>

        <TabsContent value="catalog" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Skill catalog</CardTitle>
              <CardDescription>
                {isAdmin
                  ? "Approve or reject pending skills directly from the dashboard. Skills are auto-drafted by the reflection system after complex agent runs."
                  : "Browse approved skills and monitor their approval state."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              {skills.length === 0 ? (
                <div className="flex flex-col items-center gap-4 py-12 text-center">
                  <div className="rounded-full bg-muted p-4">
                    <BookOpen className="size-8 text-muted-foreground" />
                  </div>
                  <div className="max-w-sm space-y-1">
                    <p className="font-medium">No skills yet</p>
                    <p className="text-sm text-muted-foreground">
                      Skills are automatically drafted by the reflection system after agent runs complete.
                      They appear here as <strong>drafts</strong> for admin review before becoming active.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground rounded-lg border bg-muted/50 px-4 py-2">
                    <Zap className="size-3.5 shrink-0" />
                    <span>Tip: run an agent with multiple tool calls — the reflection system will draft a skill automatically.</span>
                  </div>
                  {isAdmin && session?.accessToken && (
                    <Button variant="outline" onClick={() => setShowCreate(true)}>
                      <Plus className="size-4 mr-2" />
                      Create a skill manually
                    </Button>
                  )}
                </div>
              ) : (
                <DataTable
                  columns={columns}
                  data={skills}
                  emptyMessage="No skills found."
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="marketplace" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                SkillsMP Marketplace
                <Badge variant="secondary" className="text-xs font-normal">Community</Badge>
              </CardTitle>
              <CardDescription>
                Search and import community-published skills from{" "}
                <a
                  href="https://skillsmp.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-4 hover:text-foreground"
                >
                  skillsmp.com
                </a>
                . Imported skills are added as drafts for admin review.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {session?.accessToken ? (
                <MarketplaceTab isAdmin={isAdmin} token={session.accessToken} />
              ) : (
                <p className="text-sm text-muted-foreground">Sign in to search the marketplace.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
