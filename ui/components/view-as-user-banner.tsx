"use client";

import { Eye, X } from "lucide-react";

import { Button } from "@/components/ui/button";

interface ViewAsUserBannerProps {
  onExit: () => void;
  loading?: boolean;
}

export function ViewAsUserBanner({
  onExit,
  loading = false,
}: ViewAsUserBannerProps) {
  return (
    <div className="flex w-full shrink-0 items-center justify-between gap-3 bg-amber-500 px-4 py-2 text-sm font-medium text-amber-950">
      <div className="flex items-center gap-2">
        <Eye className="size-4" />
        <span>Admin Preview: Viewing as regular user</span>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={onExit}
        disabled={loading}
        className="h-7 px-3 text-amber-950 hover:bg-amber-600 hover:text-amber-950"
      >
        <X className="mr-1 size-3" />
        Exit Preview
      </Button>
    </div>
  );
}
