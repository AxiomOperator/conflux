"use client";

import { useSession } from "next-auth/react";
import { useEffect, useMemo, useState } from "react";

import { type CurrentUser, createApiClient } from "@/lib/api";

export function useAuth() {
  const { data: session, status } = useSession();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [isLoadingUser, setIsLoadingUser] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadUser() {
      if (!session?.accessToken) {
        setUser(null);
        setIsLoadingUser(false);
        return;
      }

      setIsLoadingUser(true);
      try {
        const me = await createApiClient(session.accessToken).users.me();
        if (!cancelled) {
          setUser(me);
        }
      } catch {
        if (!cancelled) {
          setUser(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingUser(false);
        }
      }
    }

    void loadUser();

    return () => {
      cancelled = true;
    };
  }, [session?.accessToken]);

  return useMemo(
    () => ({
      isLoading: status === "loading" || isLoadingUser,
      session,
      status,
      user,
    }),
    [isLoadingUser, session, status, user],
  );
}
