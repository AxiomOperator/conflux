import type { JWT } from "@auth/core/jwt";
import NextAuth, { type DefaultSession, type NextAuthConfig } from "next-auth";
import AzureAD from "next-auth/providers/azure-ad";
import Credentials from "next-auth/providers/credentials";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";

import {
  isSSOProviderEnabled,
  provisionSsoUser,
} from "@/lib/db";

type AzureProfile = {
  email?: string;
  name?: string;
  oid?: string;
  preferred_username?: string;
  sub?: string;
  tid?: string;
};

declare module "next-auth" {
  interface Session {
    accessToken?: string;
    idToken?: string;
    user: DefaultSession["user"] & {
      id?: string;
      tenantId?: string;
    };
  }
}

type AppJWT = JWT & {
  accessToken?: string;
  idToken?: string;
  tenantId?: string;
};

const tenantId = process.env.AZURE_AD_TENANT_ID ?? "";
const issuer = tenantId
  ? `https://login.microsoftonline.com/${tenantId}/v2.0`
  : undefined;

// ── Conditionally-included providers ─────────────────────────────────────────
// Each provider is only registered if the required env vars are present.
// The admin can further toggle each on/off from the SSO settings page.

const providers: NextAuthConfig["providers"] = [];

if (process.env.AZURE_AD_CLIENT_ID) {
  providers.push(
    AzureAD({
      authorization: {
        params: {
          scope: "openid profile email offline_access",
          redirect_uri: `${process.env.NEXTAUTH_URL ?? ""}/api/auth/callback/azure-ad`,
        },
      },
      clientId: process.env.AZURE_AD_CLIENT_ID,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET ?? "",
      issuer,
      profile(profile: AzureProfile) {
        return {
          email: profile.email ?? profile.preferred_username ?? "",
          id: profile.oid ?? profile.sub ?? "",
          image: null,
          name: profile.name ?? profile.preferred_username ?? "Conflux User",
        };
      },
    }),
  );
}

if (process.env.GITHUB_ID) {
  providers.push(
    GitHub({
      clientId: process.env.GITHUB_ID,
      clientSecret: process.env.GITHUB_SECRET ?? "",
    }),
  );
}

if (process.env.GOOGLE_CLIENT_ID) {
  providers.push(
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    }),
  );
}

// Generic OIDC (Okta, Keycloak, Auth0, etc.)
if (process.env.OIDC_CLIENT_ID && process.env.OIDC_ISSUER) {
  providers.push({
    id: "oidc",
    name: process.env.OIDC_PROVIDER_NAME ?? "SSO",
    type: "oidc" as const,
    issuer: process.env.OIDC_ISSUER,
    clientId: process.env.OIDC_CLIENT_ID,
    clientSecret: process.env.OIDC_CLIENT_SECRET ?? "",
  } as Parameters<typeof providers.push>[0]);
}

// Credentials — email + password (admin-created accounts only)
providers.push(
  Credentials({
    name: "Credentials",
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
    },
    async authorize(credentials) {
      const email = credentials?.email as string | undefined;
      const password = credentials?.password as string | undefined;
      if (!email || !password) return null;

      // Verify via FastAPI — keeps bcrypt entirely on the Python side
      const apiBase =
        process.env.INTERNAL_API_URL ??
        process.env.NEXT_PUBLIC_API_URL ??
        "http://localhost:8001";
      try {
        const res = await fetch(`${apiBase}/v1/admin/sso/verify-credentials`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        if (!res.ok) return null;
        const user = (await res.json()) as {
          id: string;
          email: string;
          display_name: string;
          is_admin: boolean;
        };
        return { id: user.id, email: user.email, name: user.display_name, image: null };
      } catch {
        return null;
      }
    },
  }),
);

// ── Auth config ───────────────────────────────────────────────────────────────

export const authConfig = {
  callbacks: {
    async signIn({ account, profile, user }) {
      const provider = account?.provider;
      if (!provider || provider === "credentials") return true;

      // Reject if the provider is disabled in DB
      const enabled = await isSSOProviderEnabled(provider);
      if (!enabled) return false;

      // Provision/upsert user in DB for all OAuth providers
      const email =
        (profile?.email as string | undefined) ?? (user?.email ?? "");
      const name =
        (profile?.name as string | undefined) ?? (user?.name ?? email);
      if (email) {
        const azureOid =
          provider === "azure-ad"
            ? ((profile as AzureProfile)?.oid ?? (profile as AzureProfile)?.sub)
            : undefined;
        await provisionSsoUser({
          email,
          display_name: name,
          ...(azureOid ? { azure_oid: azureOid } : {}),
        });
      }
      return true;
    },

    async jwt({ account, profile, token }) {
      const appToken = token as AppJWT;
      const azureProfile = profile as AzureProfile | undefined;

      if (account) {
        appToken.accessToken =
          typeof account.access_token === "string"
            ? account.access_token
            : appToken.accessToken;
        appToken.idToken =
          typeof account.id_token === "string"
            ? account.id_token
            : appToken.idToken;
      }

      appToken.tenantId = azureProfile?.tid ?? appToken.tenantId;

      if (azureProfile?.preferred_username && !appToken.email) {
        appToken.email = azureProfile.preferred_username;
      }

      if (azureProfile?.name && !appToken.name) {
        appToken.name = azureProfile.name;
      }

      return appToken;
    },

    async session({ session, token }) {
      const appToken = token as AppJWT;

      if (session.user) {
        session.user.email = appToken.email ?? session.user.email ?? "";
        session.user.id = appToken.sub ?? session.user.id ?? "";
        session.user.name = appToken.name ?? session.user.name ?? "";
        session.user.tenantId = appToken.tenantId ?? session.user.tenantId;
      }

      session.accessToken =
        typeof appToken.idToken === "string"
          ? appToken.idToken
          : typeof appToken.accessToken === "string"
            ? appToken.accessToken
            : undefined;
      session.idToken =
        typeof appToken.idToken === "string" ? appToken.idToken : undefined;

      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  providers,
  session: {
    strategy: "jwt",
  },
  trustHost: true,
} satisfies NextAuthConfig;

export const { auth, handlers, signIn, signOut } = NextAuth(authConfig);
