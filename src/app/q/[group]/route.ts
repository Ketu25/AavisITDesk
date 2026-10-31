import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth";
import { SCAN_LOCATION_PARAM, scanDestination } from "@/lib/qr-labels";

/**
 * GET /q/:group — what every printed QR label points at.
 *
 * A short address of its own rather than the Quick tickets page's, so the
 * code stays coarse enough to scan off a 1" label, and so labels already
 * stuck on printers keep working whatever that page becomes.
 *
 * Only signed-in people get here: the proxy sends anyone else to sign in
 * first, carrying this address — query and all — through it. From here they
 * go on to Quick tickets with the label's group open and its location ready
 * to fill in. Whether that group is still offered is the page's question; it
 * says so when it isn't.
 *
 * Someone still on a temporary password would be sent from that page to set
 * a new one and then dropped on the Overview, so they go to set it now, with
 * the way back attached.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ group: string }> }) {
  const { group } = await params;
  const destination = scanDestination(group, request.nextUrl.searchParams.get(SCAN_LOCATION_PARAM));

  const url = request.nextUrl.clone();
  url.search = "";
  const ctx = await getAuthContext();
  if (ctx?.profile.must_change_password) {
    url.pathname = "/activate";
    url.searchParams.set("next", destination);
  } else {
    const target = new URL(destination, url.origin);
    url.pathname = target.pathname;
    url.search = target.search;
  }
  return NextResponse.redirect(url);
}
