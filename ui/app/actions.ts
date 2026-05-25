"use server";

import { signIn, signOut } from "@/lib/auth";

export async function microsoftSignIn() {
  await signIn("azure-ad", { redirectTo: "/dashboard" });
}

export async function githubSignIn() {
  await signIn("github", { redirectTo: "/dashboard" });
}

export async function googleSignIn() {
  await signIn("google", { redirectTo: "/dashboard" });
}

export async function oidcSignIn() {
  await signIn("oidc", { redirectTo: "/dashboard" });
}

export async function credentialsSignIn(email: string, password: string) {
  await signIn("credentials", { email, password, redirectTo: "/dashboard" });
}

export async function confluxSignOut() {
  await signOut({ redirectTo: "/login" });
}
