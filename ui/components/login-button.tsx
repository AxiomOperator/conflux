import { LogIn } from "lucide-react";

import { microsoftSignIn } from "@/app/actions";
import { Button } from "@/components/ui/button";

export function LoginButton() {
  return (
    <form action={microsoftSignIn}>
      <Button type="submit" size="lg" className="w-full">
        <LogIn className="size-4" />
        Sign in with Microsoft
      </Button>
    </form>
  );
}
