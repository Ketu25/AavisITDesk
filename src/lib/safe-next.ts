/** A stand-in origin to resolve against. `.invalid` is reserved: it can never be a real site. */
const HOME = "https://desk.invalid";

/**
 * Somewhere on this site to go once signed in, from a `?next=` that anyone
 * can write into a link — or null when it would leave the site.
 *
 * "Starts with one slash" is not a test for that on its own: a browser reads
 * `/\evil.example` the way it reads `//evil.example`, and drops tabs and
 * newlines before reading either. So the address is resolved the way the
 * browser will resolve it, and kept only if it stays home. The query comes
 * back with the path: a scanned QR label's `/q/…?at=…` has to survive the
 * trip through sign-in, and through setting a first password.
 */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next || !next.startsWith("/")) return null;
  try {
    const url = new URL(next, HOME);
    return url.origin === HOME ? `${url.pathname}${url.search}${url.hash}` : null;
  } catch {
    return null;
  }
}
