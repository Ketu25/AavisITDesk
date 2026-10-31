import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { misconfiguredMessage, readPublicEnv } from "@/lib/env";
import { safeNextPath } from "@/lib/safe-next";

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
    // A fetch() cannot follow a redirect to a sign-in page and make anything
    // of it: redirects are followed transparently, so the caller gets 200 and
    // a body of HTML where it expected JSON, and `lib/api.ts` dies on the
    // first "<". An expired session has to read as 401 to the code that has
    // to handle it, and only as a redirect to a browser navigating.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Your session has expired. Sign in again to continue." },
        { status: 401 },
      );
    }

    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // Sign-in gets `next` and nothing else: the rest of the query belongs to
    // the page that was asked for, and /login reads some of the same names
    // (an `?error=` there shows a notice). It travels inside `next` instead,
    // so a scanned QR label's `/q/…?at=…`, or a link to one quick-ticket
    // group, still lands where it pointed once signed in.
    url.search = "";
    const next = `${pathname}${request.nextUrl.search}`;
    if (next !== "/") url.searchParams.set("next", next);
    return NextResponse.redirect(url);
  }

  if (user && (pathname === "/login" || pathname === "/")) {
    // Already signed in — in another tab, say — on a sign-in page that was
    // taking someone somewhere: take them there, not to the Overview.
    const next = pathname === "/login" ? safeNextPath(request.nextUrl.searchParams.get("next")) : null;
    const url = request.nextUrl.clone();
    const target = new URL(next ?? "/dashboard", url.origin);
    url.pathname = target.pathname;
    url.search = target.search;
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
