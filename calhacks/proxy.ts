// Every request passes through here first (Next 16's Proxy, formerly Middleware). Without the
// owner's session cookie, pages go to /login and API routes answer 401. Routes that write check
// again with requireOwner (lib/auth.ts), since a proxy is only a first line of defense.
import { NextResponse, type NextRequest } from "next/server";
import { authConfig, isAllowed, isPublicPath, warnOpenOnce } from "@/lib/session";

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const config = authConfig();
  const api = pathname.startsWith("/api/");

  if (config.mode === "broken") {
    // Production without a password (or without a session secret): serve nothing, say why.
    if (api) return Response.json({ error: config.error }, { status: 503 });
    return new Response(`Back of House is not set up yet.\n\n${config.error}\n`, { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  if (isPublicPath(pathname)) return NextResponse.next();
  if (config.mode === "open") {
    warnOpenOnce();
    return NextResponse.next();
  }
  if (isAllowed(request, config)) return NextResponse.next();

  if (api) return Response.json({ error: "Log in first." }, { status: 401 });
  const login = new URL("/login", request.url);
  if (pathname !== "/") login.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(login);
}

export const config = {
  // Next's own build files never need a session; everything else is checked above.
  matcher: ["/((?!_next/static|_next/image).*)"],
};
