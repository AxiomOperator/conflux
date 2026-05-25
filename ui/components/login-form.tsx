"use client";

import { useState, useTransition } from "react";
import { LogIn, Mail } from "lucide-react";

import {
  microsoftSignIn,
  githubSignIn,
  googleSignIn,
  oidcSignIn,
  credentialsSignIn,
} from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

export interface EnabledProvider {
  id: string;
  label: string;
}

interface LoginFormProps {
  providers: EnabledProvider[];
}

const PROVIDER_ACTIONS: Record<string, () => Promise<void>> = {
  "azure-ad": microsoftSignIn,
  github: githubSignIn,
  google: googleSignIn,
  oidc: oidcSignIn,
};

const PROVIDER_ICONS: Record<string, React.ReactNode> = {
  "azure-ad": (
    <svg className="size-4" viewBox="0 0 21 21" fill="none">
      <path d="M10.5 0L21 10.5L10.5 21L0 10.5z" fill="#0078d4" />
    </svg>
  ),
  github: (
    <svg className="size-4" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.44 9.8 8.2 11.39.6.11.82-.26.82-.58v-2.02c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.74.08-.73.08-.73 1.21.09 1.84 1.24 1.84 1.24 1.07 1.84 2.81 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.17 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 3-.4c1.02 0 2.04.14 3 .4 2.28-1.55 3.29-1.23 3.29-1.23.66 1.65.24 2.87.12 3.17.77.84 1.23 1.91 1.23 3.22 0 4.61-2.8 5.63-5.48 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.21.7.83.58C20.57 21.8 24 17.3 24 12 24 5.37 18.63 0 12 0z" />
    </svg>
  ),
  google: (
    <svg className="size-4" viewBox="0 0 24 24">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  ),
  oidc: <LogIn className="size-4" />,
};

export function LoginForm({ providers }: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const oauthProviders = providers.filter((p) => p.id !== "credentials");
  const hasCredentials = providers.some((p) => p.id === "credentials");
  const showSeparator = oauthProviders.length > 0 && hasCredentials;

  function handleOAuth(providerId: string) {
    const action = PROVIDER_ACTIONS[providerId];
    if (!action) return;
    startTransition(async () => {
      await action();
    });
  }

  function handleCredentials(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        await credentialsSignIn(email, password);
      } catch {
        setError("Invalid email or password.");
      }
    });
  }

  if (providers.length === 0) {
    return (
      <p className="text-center text-sm text-muted-foreground">
        No sign-in methods are currently enabled. Contact your administrator.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {oauthProviders.map((p) => (
        <form key={p.id} onSubmit={(e) => { e.preventDefault(); handleOAuth(p.id); }}>
          <Button
            type="submit"
            size="lg"
            variant="outline"
            className="w-full"
            disabled={isPending}
          >
            {PROVIDER_ICONS[p.id] ?? <LogIn className="size-4" />}
            {p.label}
          </Button>
        </form>
      ))}

      {showSeparator && (
        <div className="flex items-center gap-3 py-1">
          <Separator className="flex-1" />
          <span className="text-xs text-muted-foreground">or</span>
          <Separator className="flex-1" />
        </div>
      )}

      {hasCredentials && (
        <form onSubmit={handleCredentials} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={isPending}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={isPending}
            />
          </div>
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
          <Button type="submit" size="lg" className="w-full" disabled={isPending}>
            <Mail className="size-4" />
            Sign in
          </Button>
        </form>
      )}
    </div>
  );
}
