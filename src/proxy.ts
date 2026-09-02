import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { misconfiguredMessage, readPublicEnv } from "@/lib/env";

/** Paths reachable without a session. Everything else requires one. */
const PUBLIC_PATHS = [
  "/login",
  "/activate",
  "/invite",
  "/forgot-password",
  "/reset-password",
  "/auth/callback",
];

export async function proxy(request: NextRequest) {
  // Fail loudly and specifically. Without this, a missing build variable makes
  // createServerClient throw on every single request and the whole site — login
  // included — returns an unexplained 500.
  const config = readPublicEnv();
  if (!config.ok) {
    return new NextResponse(misconfiguredMessage(config.missing), {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    config.env.supabaseUrl,
    config.env.supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Refreshes an expiring session and writes the rotated cookie onto `response`.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (user && (pathname === "/login" || pathname === "/")) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
