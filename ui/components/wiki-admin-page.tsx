"use client";

import { BookOpen, Plus, Shield, Trash2, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmojiIconPicker } from "@/components/emoji-icon-picker";
import type { UserRecord } from "@/lib/api";

interface WikiGroup {
  created_at: string;
  description: string | null;
  id: string;
  name: string;
}

interface WikiSpace {
  created_at: string;
  created_by: string | null;
  default_access: "private" | "public";
  description: string | null;
  icon: string | null;
  id: string;
  name: string;
  slug: string;
}

type WikiRuleSubjectType = "everyone" | "group" | "user";
type WikiRulePermission = "view" | "edit" | "admin";

interface WikiRule {
  id: string;
  page_id: string | null;
  permission: WikiRulePermission;
  space_id: string | null;
  subject_id: string | null;
  subject_type: WikiRuleSubjectType;
}

interface StatusMessage {
  text: string;
  tone: "error" | "success";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getErrorMessage(data: unknown, fallback: string) {
  if (isRecord(data)) {
    if (typeof data.detail === "string") {
      return data.detail;
    }
    if (typeof data.error === "string") {
      return data.error;
    }
    if (typeof data.message === "string") {
      return data.message;
    }
  }
  return fallback;
}

async function requestJson<T>(
  input: RequestInfo,
  init: RequestInit,
  fallback: string,
) {
  const response = await fetch(input, init);
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(getErrorMessage(data, fallback));
  }
  return data as T;
}

async function requestVoid(
  input: RequestInfo,
  init: RequestInit,
  fallback: string,
) {
  const response = await fetch(input, init);
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(getErrorMessage(data, fallback));
  }
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function WikiAdminPage() {
  const [tab, setTab] = useState("groups");
  const [groups, setGroups] = useState<WikiGroup[]>([]);
  const [spaces, setSpaces] = useState<WikiSpace[]>([]);
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [spaceRules, setSpaceRules] = useState<WikiRule[]>([]);
  const [selectedSpaceId, setSelectedSpaceId] = useState("");
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadingRules, setLoadingRules] = useState(false);

  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupDesc, setNewGroupDesc] = useState("");

  const [memberDialogGroup, setMemberDialogGroup] = useState<WikiGroup | null>(
    null,
  );
  const [memberIdentifier, setMemberIdentifier] = useState("");

  const [newSpaceName, setNewSpaceName] = useState("");
  const [newSpaceSlug, setNewSpaceSlug] = useState("");
  const [newSpaceDescription, setNewSpaceDescription] = useState("");
  const [newSpaceIcon, setNewSpaceIcon] = useState("📚");
  const [newSpaceAccess, setNewSpaceAccess] =
    useState<WikiSpace["default_access"]>("private");

  const [newRuleSubjectType, setNewRuleSubjectType] =
    useState<WikiRuleSubjectType>("everyone");
  const [newRuleSubjectId, setNewRuleSubjectId] = useState("");
  const [newRulePermission, setNewRulePermission] =
    useState<WikiRulePermission>("view");

  const userMap = useMemo(
    () => new Map(users.map((user) => [user.id, user])),
    [users],
  );
  const groupMap = useMemo(
    () => new Map(groups.map((group) => [group.id, group])),
    [groups],
  );

  const memberMatch = useMemo(() => {
    const trimmed = memberIdentifier.trim();
    if (!trimmed) {
      return null;
    }
    const lower = trimmed.toLowerCase();
    return (
      users.find(
        (user) => user.id === trimmed || user.email.toLowerCase() === lower,
      ) ?? null
    );
  }, [memberIdentifier, users]);

  const ruleUserMatch = useMemo(() => {
    const trimmed = newRuleSubjectId.trim();
    if (!trimmed || newRuleSubjectType !== "user") {
      return null;
    }
    const lower = trimmed.toLowerCase();
    return (
      users.find(
        (user) => user.id === trimmed || user.email.toLowerCase() === lower,
      ) ?? null
    );
  }, [newRuleSubjectId, newRuleSubjectType, users]);

  const fetchGroups = useCallback(async () => {
    const data = await requestJson<WikiGroup[]>(
      "/api/admin/wiki/groups",
      { cache: "no-store" },
      "Failed to load wiki groups",
    );
    setGroups(data);
  }, []);

  const fetchSpaces = useCallback(async () => {
    const data = await requestJson<WikiSpace[]>(
      "/api/admin/wiki/spaces",
      { cache: "no-store" },
      "Failed to load wiki spaces",
    );
    setSpaces(data);
    setSelectedSpaceId((current) => {
      if (current && data.some((space) => space.id === current)) {
        return current;
      }
      return data[0]?.id ?? "";
    });
  }, []);

  const fetchUsers = useCallback(async () => {
    const data = await requestJson<UserRecord[]>(
      "/api/admin/sso-users",
      { cache: "no-store" },
      "Failed to load users",
    );
    setUsers(data);
  }, []);

  const fetchRules = useCallback(async (spaceId: string) => {
    if (!spaceId) {
      setSpaceRules([]);
      return;
    }

    setLoadingRules(true);
    try {
      const data = await requestJson<WikiRule[]>(
        `/api/admin/wiki/spaces/${spaceId}/rules`,
        { cache: "no-store" },
        "Failed to load access rules",
      );
      setSpaceRules(data);
    } finally {
      setLoadingRules(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoadingInitial(true);
      try {
        await Promise.all([fetchGroups(), fetchSpaces(), fetchUsers()]);
      } catch (error) {
        if (!cancelled) {
          setStatus({
            text:
              error instanceof Error
                ? error.message
                : "Failed to load wiki admin data",
            tone: "error",
          });
        }
      } finally {
        if (!cancelled) {
          setLoadingInitial(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [fetchGroups, fetchSpaces, fetchUsers]);

  useEffect(() => {
    if (!selectedSpaceId) {
      setSpaceRules([]);
      return;
    }

    void fetchRules(selectedSpaceId).catch((error: unknown) => {
      setStatus({
        text:
          error instanceof Error
            ? error.message
            : "Failed to load access rules",
        tone: "error",
      });
    });
  }, [fetchRules, selectedSpaceId]);

  useEffect(() => {
    if (newRuleSubjectType === "everyone") {
      setNewRuleSubjectId("");
      return;
    }

    if (
      newRuleSubjectType === "group" &&
      !groups.some((group) => group.id === newRuleSubjectId)
    ) {
      setNewRuleSubjectId(groups[0]?.id ?? "");
    }
  }, [groups, newRuleSubjectId, newRuleSubjectType]);

  function setErrorStatus(error: unknown, fallback: string) {
    setStatus({
      text: error instanceof Error ? error.message : fallback,
      tone: "error",
    });
  }

  function resolveUserId(value: string) {
    const trimmed = value.trim();
    if (!trimmed) {
      throw new Error("User email or UUID is required");
    }
    if (!trimmed.includes("@")) {
      return trimmed;
    }
    const match = users.find(
      (user) => user.email.toLowerCase() === trimmed.toLowerCase(),
    );
    if (!match) {
      throw new Error("No loaded user matched that email address");
    }
    return match.id;
  }

  async function createGroup() {
    if (!newGroupName.trim()) {
      return;
    }

    try {
      await requestJson<WikiGroup>(
        "/api/admin/wiki/groups",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            description: newGroupDesc.trim() || null,
            name: newGroupName.trim(),
          }),
        },
        "Failed to create group",
      );
      setNewGroupName("");
      setNewGroupDesc("");
      setStatus({ text: "Wiki group created", tone: "success" });
      await fetchGroups();
    } catch (error) {
      setErrorStatus(error, "Failed to create group");
    }
  }

  async function deleteGroup(groupId: string) {
    if (!window.confirm("Delete this wiki group?")) {
      return;
    }

    try {
      await requestVoid(
        `/api/admin/wiki/groups/${groupId}`,
        { method: "DELETE" },
        "Failed to delete group",
      );
      if (memberDialogGroup?.id === groupId) {
        setMemberDialogGroup(null);
        setMemberIdentifier("");
      }
      setStatus({ text: "Wiki group deleted", tone: "success" });
      await fetchGroups();
    } catch (error) {
      setErrorStatus(error, "Failed to delete group");
    }
  }

  async function addGroupMember() {
    if (!memberDialogGroup) {
      return;
    }

    try {
      const userId = resolveUserId(memberIdentifier);
      await requestJson<{ group_id: string; user_id: string }>(
        `/api/admin/wiki/groups/${memberDialogGroup.id}/members`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_id: userId }),
        },
        "Failed to add group member",
      );
      setMemberIdentifier("");
      setStatus({ text: "Group member added", tone: "success" });
    } catch (error) {
      setErrorStatus(error, "Failed to add group member");
    }
  }

  async function removeGroupMember() {
    if (!memberDialogGroup) {
      return;
    }

    try {
      const userId = resolveUserId(memberIdentifier);
      await requestVoid(
        `/api/admin/wiki/groups/${memberDialogGroup.id}/members/${userId}`,
        { method: "DELETE" },
        "Failed to remove group member",
      );
      setMemberIdentifier("");
      setStatus({ text: "Group member removed", tone: "success" });
    } catch (error) {
      setErrorStatus(error, "Failed to remove group member");
    }
  }

  async function createSpace() {
    if (!newSpaceName.trim()) {
      return;
    }

    try {
      await requestJson<WikiSpace>(
        "/api/admin/wiki/spaces",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            default_access: newSpaceAccess,
            description: newSpaceDescription.trim() || null,
            icon: newSpaceIcon.trim() || null,
            name: newSpaceName.trim(),
            slug: newSpaceSlug.trim() || slugify(newSpaceName),
          }),
        },
        "Failed to create space",
      );
      setNewSpaceName("");
      setNewSpaceSlug("");
      setNewSpaceDescription("");
      setNewSpaceIcon("📚");
      setNewSpaceAccess("private");
      setStatus({ text: "Wiki space created", tone: "success" });
      await fetchSpaces();
    } catch (error) {
      setErrorStatus(error, "Failed to create space");
    }
  }

  async function deleteSpace(spaceId: string) {
    if (!window.confirm("Delete this space and all of its pages?")) {
      return;
    }

    try {
      await requestVoid(
        `/api/admin/wiki/spaces/${spaceId}`,
        { method: "DELETE" },
        "Failed to delete space",
      );
      if (selectedSpaceId === spaceId) {
        setSelectedSpaceId("");
        setSpaceRules([]);
      }
      setStatus({ text: "Wiki space deleted", tone: "success" });
      await fetchSpaces();
    } catch (error) {
      setErrorStatus(error, "Failed to delete space");
    }
  }

  async function addRule() {
    if (!selectedSpaceId) {
      return;
    }

    try {
      let subjectId: string | null = null;
      if (newRuleSubjectType === "group") {
        if (!newRuleSubjectId) {
          throw new Error("Select a group");
        }
        subjectId = newRuleSubjectId;
      } else if (newRuleSubjectType === "user") {
        subjectId = resolveUserId(newRuleSubjectId);
      }

      await requestJson<WikiRule>(
        `/api/admin/wiki/spaces/${selectedSpaceId}/rules`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            permission: newRulePermission,
            subject_id: subjectId,
            subject_type: newRuleSubjectType,
          }),
        },
        "Failed to add access rule",
      );
      if (newRuleSubjectType === "user") {
        setNewRuleSubjectId("");
      }
      setStatus({ text: "Access rule added", tone: "success" });
      await fetchRules(selectedSpaceId);
    } catch (error) {
      setErrorStatus(error, "Failed to add access rule");
    }
  }

  async function deleteRule(ruleId: string) {
    try {
      await requestVoid(
        `/api/admin/wiki/rules/${ruleId}`,
        { method: "DELETE" },
        "Failed to delete access rule",
      );
      setStatus({ text: "Access rule deleted", tone: "success" });
      if (selectedSpaceId) {
        await fetchRules(selectedSpaceId);
      }
    } catch (error) {
      setErrorStatus(error, "Failed to delete access rule");
    }
  }

  function getRuleSubjectLabel(rule: WikiRule) {
    if (rule.subject_type === "everyone") {
      return "Everyone";
    }
    if (!rule.subject_id) {
      return "Unknown";
    }
    if (rule.subject_type === "group") {
      return groupMap.get(rule.subject_id)?.name ?? rule.subject_id;
    }
    const user = userMap.get(rule.subject_id);
    return user?.email ?? rule.subject_id;
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <BookOpen className="size-6" />
            Wiki Administration
          </h1>
          <p className="text-muted-foreground">
            Manage wiki groups, spaces, and access control rules.
          </p>
        </div>
        {status ? (
          <div
            className={
              status.tone === "error"
                ? "rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                : "rounded-md border border-emerald-500/40 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300"
            }
          >
            {status.text}
          </div>
        ) : null}
      </div>

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="groups">
            <Users className="mr-1 size-4" />
            Groups
          </TabsTrigger>
          <TabsTrigger value="spaces">
            <BookOpen className="mr-1 size-4" />
            Spaces
          </TabsTrigger>
          <TabsTrigger value="acl">
            <Shield className="mr-1 size-4" />
            Access Rules
          </TabsTrigger>
        </TabsList>

        <TabsContent value="groups" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Create Group</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
              <div className="space-y-1.5">
                <Label htmlFor="wiki-group-name">Name</Label>
                <Input
                  id="wiki-group-name"
                  value={newGroupName}
                  onChange={(event) => setNewGroupName(event.target.value)}
                  placeholder="e.g. Engineering"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wiki-group-description">Description</Label>
                <Input
                  id="wiki-group-description"
                  value={newGroupDesc}
                  onChange={(event) => setNewGroupDesc(event.target.value)}
                  placeholder="Optional description"
                />
              </div>
              <Button
                disabled={!newGroupName.trim()}
                onClick={() => void createGroup()}
              >
                <Plus className="mr-1 size-4" />
                Create Group
              </Button>
            </CardContent>
          </Card>

          <div className="space-y-2">
            {loadingInitial ? (
              <p className="text-sm text-muted-foreground">
                Loading wiki groups…
              </p>
            ) : groups.length === 0 ? (
              <p className="text-sm text-muted-foreground">No groups yet.</p>
            ) : (
              groups.map((group) => (
                <Card key={group.id}>
                  <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{group.name}</p>
                        <Badge variant="outline">group</Badge>
                      </div>
                      {group.description ? (
                        <p className="text-sm text-muted-foreground">
                          {group.description}
                        </p>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          No description provided.
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2 self-start sm:self-center">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setMemberDialogGroup(group);
                          setMemberIdentifier("");
                        }}
                      >
                        <Users className="mr-1 size-4" />
                        Members
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void deleteGroup(group.id)}
                      >
                        <Trash2 className="size-4 text-red-500" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="spaces" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Create Space</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_120px_180px_auto] xl:items-end">
              <div className="space-y-1.5">
                <Label htmlFor="wiki-space-name">Name</Label>
                <Input
                  id="wiki-space-name"
                  value={newSpaceName}
                  onChange={(event) => setNewSpaceName(event.target.value)}
                  placeholder="e.g. Engineering Docs"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wiki-space-slug">Slug</Label>
                <Input
                  id="wiki-space-slug"
                  value={newSpaceSlug}
                  onChange={(event) => setNewSpaceSlug(event.target.value)}
                  placeholder="auto-generated from name"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wiki-space-description">Description</Label>
                <Input
                  id="wiki-space-description"
                  value={newSpaceDescription}
                  onChange={(event) =>
                    setNewSpaceDescription(event.target.value)
                  }
                  placeholder="Optional description"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Icon</Label>
                <EmojiIconPicker
                  value={newSpaceIcon}
                  onChange={setNewSpaceIcon}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Default Access</Label>
                <Select
                  value={newSpaceAccess}
                  onValueChange={(value) =>
                    setNewSpaceAccess(value as WikiSpace["default_access"])
                  }
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
              <Button
                disabled={!newSpaceName.trim()}
                onClick={() => void createSpace()}
              >
                <Plus className="mr-1 size-4" />
                Create Space
              </Button>
            </CardContent>
          </Card>

          <div className="space-y-2">
            {loadingInitial ? (
              <p className="text-sm text-muted-foreground">
                Loading wiki spaces…
              </p>
            ) : spaces.length === 0 ? (
              <p className="text-sm text-muted-foreground">No spaces yet.</p>
            ) : (
              spaces.map((space) => (
                <Card key={space.id}>
                  <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="text-2xl leading-none">
                        {space.icon || "📄"}
                      </span>
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2">
                          <p className="font-medium">{space.name}</p>
                          <Badge variant="outline">
                            {space.default_access}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          /{space.slug}
                        </p>
                        {space.description ? (
                          <p className="text-sm text-muted-foreground">
                            {space.description}
                          </p>
                        ) : null}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="self-start sm:self-center"
                      onClick={() => void deleteSpace(space.id)}
                    >
                      <Trash2 className="size-4 text-red-500" />
                    </Button>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="acl" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Access Rules</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label>Select Space</Label>
                <Select
                  value={selectedSpaceId || undefined}
                  onValueChange={setSelectedSpaceId}
                >
                  <SelectTrigger className="w-full max-w-sm">
                    <SelectValue placeholder="Choose a space…" />
                  </SelectTrigger>
                  <SelectContent>
                    {spaces.map((space) => (
                      <SelectItem key={space.id} value={space.id}>
                        {`${space.icon || "📄"} ${space.name}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {!selectedSpaceId ? (
                <p className="text-sm text-muted-foreground">
                  Select a space to manage access rules.
                </p>
              ) : (
                <div className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-[160px_minmax(0,1fr)_140px_auto] md:items-end">
                    <div className="space-y-1.5">
                      <Label>Subject</Label>
                      <Select
                        value={newRuleSubjectType}
                        onValueChange={(value) =>
                          setNewRuleSubjectType(value as WikiRuleSubjectType)
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="everyone">Everyone</SelectItem>
                          <SelectItem value="group">Group</SelectItem>
                          <SelectItem value="user">User</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {newRuleSubjectType === "group" ? (
                      <div className="space-y-1.5">
                        <Label>Group</Label>
                        <Select
                          value={newRuleSubjectId || undefined}
                          onValueChange={setNewRuleSubjectId}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Choose a group…" />
                          </SelectTrigger>
                          <SelectContent>
                            {groups.map((group) => (
                              <SelectItem key={group.id} value={group.id}>
                                {group.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ) : newRuleSubjectType === "user" ? (
                      <div className="space-y-1.5">
                        <Label htmlFor="wiki-rule-user">
                          User email or UUID
                        </Label>
                        <Input
                          id="wiki-rule-user"
                          value={newRuleSubjectId}
                          onChange={(event) =>
                            setNewRuleSubjectId(event.target.value)
                          }
                          placeholder="name@example.com or user UUID"
                        />
                        {ruleUserMatch ? (
                          <p className="text-xs text-muted-foreground">
                            Resolved to {ruleUserMatch.email}
                          </p>
                        ) : newRuleSubjectId.trim().includes("@") ? (
                          <p className="text-xs text-muted-foreground">
                            Enter a known user email or paste a UUID.
                          </p>
                        ) : null}
                      </div>
                    ) : (
                      <div className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground md:min-h-10 md:self-end">
                        Applies to every user with wiki access.
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <Label>Permission</Label>
                      <Select
                        value={newRulePermission}
                        onValueChange={(value) =>
                          setNewRulePermission(value as WikiRulePermission)
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="view">View</SelectItem>
                          <SelectItem value="edit">Edit</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <Button onClick={() => void addRule()}>
                      <Plus className="mr-1 size-4" />
                      Add Rule
                    </Button>
                  </div>

                  <div className="space-y-2">
                    {loadingRules ? (
                      <p className="text-sm text-muted-foreground">
                        Loading access rules…
                      </p>
                    ) : spaceRules.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No access rules for this space.
                      </p>
                    ) : (
                      spaceRules.map((rule) => (
                        <Card key={rule.id}>
                          <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex min-w-0 flex-wrap items-center gap-2">
                              <Badge>{rule.subject_type}</Badge>
                              <span className="text-sm font-medium">
                                {getRuleSubjectLabel(rule)}
                              </span>
                              {rule.subject_id ? (
                                <code className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                                  {rule.subject_id}
                                </code>
                              ) : null}
                              <span className="text-muted-foreground">→</span>
                              <Badge variant="outline">{rule.permission}</Badge>
                              {rule.page_id ? (
                                <Badge variant="secondary">page-level</Badge>
                              ) : null}
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="self-start sm:self-center"
                              onClick={() => void deleteRule(rule.id)}
                            >
                              <Trash2 className="size-4 text-red-500" />
                            </Button>
                          </CardContent>
                        </Card>
                      ))
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog
        open={Boolean(memberDialogGroup)}
        onOpenChange={(open) => {
          if (!open) {
            setMemberDialogGroup(null);
            setMemberIdentifier("");
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {memberDialogGroup
                ? `Manage members for ${memberDialogGroup.name}`
                : "Manage group members"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="wiki-member-id">User email or UUID</Label>
              <Input
                id="wiki-member-id"
                value={memberIdentifier}
                onChange={(event) => setMemberIdentifier(event.target.value)}
                placeholder="name@example.com or user UUID"
              />
              {memberMatch ? (
                <p className="text-xs text-muted-foreground">
                  Resolved to {memberMatch.email} ({memberMatch.id})
                </p>
              ) : memberIdentifier.trim().includes("@") ? (
                <p className="text-xs text-muted-foreground">
                  Enter a known user email or paste a UUID.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Use a user email for lookup or paste a UUID directly.
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void addGroupMember()}>
                <Plus className="mr-1 size-4" />
                Add Member
              </Button>
              <Button
                variant="outline"
                onClick={() => void removeGroupMember()}
              >
                <Trash2 className="mr-1 size-4" />
                Remove Member
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
