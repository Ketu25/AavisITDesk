/**
 * Public configuration required before the app can serve anything.
 *
 * These are read in the proxy, which runs on every request. Passing `undefined`
 * to `createServerClient` throws, so a missing value takes down every route —
 * including /login — as a bare 500 with nothing in the response to explain it.
 * Checking first lets us say exactly what is wrong instead.
 *
 * Note these are inlined by `next build`, so they must be present at BUILD
 * time. Setting them as Cloudflare Worker runtime variables is too late.
 */
export type PublicEnv = {
  supabaseUrl: string;
  supabaseAnonKey: string;
};

export function readPublicEnv():
  | { ok: true; env: PublicEnv }
  | { ok: false; missing: string[] } {
  // Written out in full rather than looked up dynamically: Next replaces
  // `process.env.NEXT_PUBLIC_*` by literal text substitution, so a computed
  // key would never be replaced.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const missing: string[] = [];
  if (!supabaseUrl) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!supabaseAnonKey) missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  if (missing.length > 0) return { ok: false, missing };
  return { ok: true, env: { supabaseUrl: supabaseUrl!, supabaseAnonKey: supabaseAnonKey! } };
}

export function misconfiguredMessage(missing: string[]) {
  return [
    "Aavis IT Desk is not configured.",
    "",
    `Missing at build time: ${missing.join(", ")}`,
    "",
    "These are compiled into the bundle by `next build`, so they must be set",
    "when the build runs — a Worker runtime variable is applied too late and",
    "will be ignored. Set them as BUILD variables, or commit them to",
    ".env.production, then redeploy.",
  ].join("\n");
}
