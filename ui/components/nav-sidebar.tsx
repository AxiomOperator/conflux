"use client";

import type { LucideIcon } from "lucide-react";
import { ExternalLink, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { SignOutButton } from "@/components/sign-out-button";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface NavItem {
  href: string;
  icon: LucideIcon;
  label: string;
  external?: boolean;
  adminOnly?: boolean;
}

export interface NavGroup {
  label?: string;
  items: NavItem[];
}

function initialsFromName(name: string, email: string) {
  const source = name.trim() || email.trim() || "C";
  return (
    source
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("") || "C"
  );
}

export function NavSidebar({
  groups,
  isAdmin,
  onClose,
  open,
  user,
}: {
  groups: NavGroup[];
  isAdmin: boolean;
  onClose: () => void;
  open: boolean;
  user: { name: string; email: string; image?: string | null };
}) {
  const pathname = usePathname();

  return (
    <>
      {/* Mobile backdrop */}
      <button
        aria-label="Close navigation"
        className={cn(
          "fixed inset-0 z-30 bg-black/50 transition-opacity lg:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={onClose}
        tabIndex={open ? 0 : -1}
        type="button"
      />

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r bg-sidebar text-sidebar-foreground transition-transform duration-200 lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {/* Logo / Brand */}
        <div className="flex items-center justify-between border-b px-5 py-4 lg:justify-start">
          <div>
            <p className="text-lg font-bold tracking-tight">Conflux</p>
            <p className="text-xs text-muted-foreground">Operations Console</p>
          </div>
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>

        {/* Nav groups */}
        <nav className="flex-1 overflow-y-auto py-3">
          {groups.map((group, gi) => {
            const visibleItems = group.items.filter(
              (item) => !item.adminOnly || isAdmin,
            );
            if (visibleItems.length === 0) return null;

            // Collect all nav hrefs so prefix matching doesn't activate a parent
            // when a more specific child nav item already matches exactly.
            const allHrefs = groups.flatMap((g) => g.items.map((i) => i.href));
            const exactMatchExists = allHrefs.includes(pathname);

            return (
              <div key={gi} className={cn("px-3", gi > 0 && "mt-4")}>
                {group.label && (
                  <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
                    {group.label}
                  </p>
                )}
                <div className="space-y-0.5">
                  {visibleItems.map((item) => {
                    const Icon = item.icon;
                    const isActive =
                      !item.external &&
                      (pathname === item.href ||
                        (!exactMatchExists &&
                          item.href !== "/dashboard" &&
                          pathname.startsWith(item.href + "/")));

                    const inner = (
                      <>
                        <Icon className="size-4 shrink-0" />
                        <span className="flex-1 truncate">{item.label}</span>
                        {item.external && (
                          <ExternalLink className="size-3 shrink-0 opacity-50" />
                        )}
                      </>
                    );

                    return (
                      <Button
                        key={item.href}
                        asChild
                        variant={isActive ? "secondary" : "ghost"}
                        className="h-9 w-full justify-start gap-2.5 px-2 text-sm"
                      >
                        {item.external ? (
                          <a
                            href={item.href}
                            onClick={onClose}
                            rel="noreferrer"
                            target="_blank"
                          >
                            {inner}
                          </a>
                        ) : (
                          <Link href={item.href} onClick={onClose}>
                            {inner}
                          </Link>
                        )}
                      </Button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        {/* User footer */}
        <div className="border-t px-3 py-3">
          <div className="flex items-center gap-2.5 rounded-md px-2 py-2">
            <Avatar
              alt={user.name}
              fallback={initialsFromName(user.name, user.email)}
              src={user.image}
              className="size-7 shrink-0 text-xs"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium leading-tight">{user.name}</p>
              <p className="truncate text-xs leading-tight text-muted-foreground">{user.email}</p>
            </div>
            <SignOutButton compact />
          </div>
        </div>
      </aside>
    </>
  );
}
