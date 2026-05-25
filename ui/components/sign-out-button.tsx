import { LogOut } from "lucide-react";

import { confluxSignOut } from "@/app/actions";
import { Button } from "@/components/ui/button";

export function SignOutButton({ compact = false }: { compact?: boolean }) {
  return (
    <form action={confluxSignOut}>
      <Button
        variant={compact ? "ghost" : "outline"}
        size={compact ? "icon" : "sm"}
        type="submit"
        title={compact ? "Sign out" : undefined}
        className={compact ? "size-7 text-muted-foreground hover:bg-accent hover:text-foreground" : undefined}
      >
        <LogOut className={compact ? "size-3.5" : "size-4"} />
        {!compact ? "Sign out" : null}
      </Button>
    </form>
  );
}
