"use client";

import {
  Activity,
  BarChart2,
  BookOpen,
  Bot,
  Brain,
  Clock,
  Cpu,
  Eye,
  FlaskConical,
  GraduationCap,
  KeyRound,
  LayoutDashboard,
  Mail,
  Menu,
  MessageSquareIcon,
  Network,
  ScrollText,
  Server,
  Settings,
  Settings2,
  Shield,
  SlidersHorizontal,
  SparklesIcon,
  Wrench,
} from "lucide-react";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { ModeToggle } from "@/components/mode-toggle";
import { type NavGroup, NavSidebar } from "@/components/nav-sidebar";
import { Button } from "@/components/ui/button";
import { ViewAsUserBanner } from "@/components/view-as-user-banner";
import { useViewAsUser } from "@/hooks/useViewAsUser";
import { isEffectiveAdmin } from "@/lib/api";

export function DashboardShell({
  children,
  user,
}: {
  children: ReactNode;
  user: {
    email: string;
    image?: string | null;
    isAdmin: boolean;
    name: string;
    viewAsUser?: boolean;
  };
}) {
  const [open, setOpen] = useState(false);
  const { disable, enable, loading: viewAsUserLoading } = useViewAsUser();
  const synapseUrl = process.env.NEXT_PUBLIC_SYNAPSE_URL;
  const effectiveIsAdmin = isEffectiveAdmin({
    is_admin: user.isAdmin,
    view_as_user: user.viewAsUser,
  });

  const navGroups = useMemo<NavGroup[]>(
    () => [
      {
        items: [
          { href: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
          { href: "/chat", icon: MessageSquareIcon, label: "Chat" },
          { href: "/playground", icon: SparklesIcon, label: "Playground" },
          { href: "/insights", icon: BarChart2, label: "Insights" },
          { href: "/wiki", icon: BookOpen, label: "Wiki" },
        ],
      },
      {
        label: "Agents",
        items: [
          { href: "/agents", icon: Bot, label: "Agents" },
          { href: "/colony", icon: Network, label: "Colony" },
          { href: "/runs", icon: Activity, label: "Runs" },
          { href: "/schedules", icon: Clock, label: "Schedules" },
        ],
      },
      {
        label: "Intelligence",
        items: [
          { href: "/memory", icon: Brain, label: "Memory" },
          { href: "/skills", icon: Settings2, label: "Skills" },
          { href: "/learning", icon: FlaskConical, label: "Learning" },
        ],
      },
      ...(synapseUrl
        ? [
            {
              label: "Tools",
              items: [
                {
                  href: synapseUrl,
                  icon: Cpu,
                  label: "Synapse",
                  external: true,
                },
              ],
            },
          ]
        : []),
      {
        label: "System",
        items: [
          { href: "/admin", icon: Shield, label: "Admin", adminOnly: true },
          {
            href: "/admin/trajectories",
            icon: GraduationCap,
            label: "Trajectories",
            adminOnly: true,
          },
          {
            href: "/admin/mcp",
            icon: Server,
            label: "MCP Servers",
            adminOnly: true,
          },
          {
            href: "/admin/sso",
            icon: KeyRound,
            label: "SSO Providers",
            adminOnly: true,
          },
          {
            href: "/admin/agentmail",
            icon: Mail,
            label: "AgentMail",
            adminOnly: true,
          },
          {
            href: "/admin/diagnostics",
            icon: Wrench,
            label: "Diagnostics",
            adminOnly: true,
          },
          {
            href: "/admin/wiki",
            icon: BookOpen,
            label: "Wiki",
            adminOnly: true,
          },
          {
            href: "/admin/settings",
            icon: SlidersHorizontal,
            label: "System Settings",
            adminOnly: true,
          },
          {
            href: "/admin/traces",
            icon: Activity,
            label: "Traces",
            adminOnly: true,
          },
          {
            href: "/admin/audit",
            icon: ScrollText,
            label: "Audit Trail",
            adminOnly: true,
          },
          {
            href: "/admin/improvement",
            icon: FlaskConical,
            label: "Improvement",
            adminOnly: true,
          },
          { href: "/settings", icon: Settings, label: "Settings" },
          { href: "/changelog", icon: ScrollText, label: "Changelog" },
        ],
      },
    ],
    [synapseUrl],
  );

  return (
    <div className="h-screen overflow-hidden bg-muted/30">
      <NavSidebar
        groups={navGroups}
        isAdmin={effectiveIsAdmin}
        onClose={() => setOpen(false)}
        open={open}
        user={user}
      />
      <div className="flex h-full flex-col lg:pl-72">
        {user.viewAsUser ? (
          <ViewAsUserBanner onExit={disable} loading={viewAsUserLoading} />
        ) : null}
        <header className="shrink-0 border-b bg-background/90 backdrop-blur">
          <div className="flex h-14 items-center gap-4 px-4 md:px-6">
            <Button
              variant="outline"
              size="icon"
              className="shrink-0 lg:hidden"
              onClick={() => setOpen(true)}
            >
              <Menu className="size-4" />
            </Button>
            <div className="flex-1">
              <p className="text-lg font-semibold leading-tight">
                Agent Operations
              </p>
            </div>
            {effectiveIsAdmin ? (
              <Button
                variant="outline"
                size="sm"
                onClick={enable}
                disabled={viewAsUserLoading}
                title="Preview as regular user"
                className="gap-1.5 text-xs"
              >
                <Eye className="size-3.5" />
                View as User
              </Button>
            ) : null}
            <ModeToggle />
          </div>
        </header>
        <main className="flex-1 overflow-auto px-4 py-6 md:px-6">
          {children}
        </main>
      </div>
    </div>
  );
}
