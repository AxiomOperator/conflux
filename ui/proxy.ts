import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";

const internalSecret = process.env.INTERNAL_API_SECRET ?? "";

export default auth((request) => {
  const { pathname, search } = request.nextUrl;
  const isAuthRoute = pathname.startsWith("/api/auth");
  const isLoginRoute = pathname === "/login";
  const isApiProxy = pathname.startsWith("/v1/");

  if (isApiProxy) {
    // For authenticated users hitting the API proxy, inject trusted internal headers
    // so the backend can identify the user without needing Azure AD JWT validation.
    if (request.auth?.user?.email && internalSecret) {
      const headers = new Headers(request.headers);
      headers.set("X-Internal-Secret", internalSecret);
      headers.set("X-User-Email", request.auth.user.email);
      return NextResponse.next({ request: { headers } });
    }
    return NextResponse.next();
  }

  if (!request.auth && !isAuthRoute && !isLoginRoute) {
    const loginUrl = new URL("/login", request.url);
    const callbackUrl = `${pathname}${search}`;
    if (callbackUrl && callbackUrl !== "/login") {
      loginUrl.searchParams.set("callbackUrl", callbackUrl);
    }
    return NextResponse.redirect(loginUrl);
  }

  if (request.auth && isLoginRoute) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
