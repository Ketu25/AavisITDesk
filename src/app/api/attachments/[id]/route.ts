import { NextResponse, type NextRequest } from "next/server";
import { apiError, ApiError, requireApiUser, routeUuid } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase/server";
import { ATTACHMENT_BUCKET } from "@/lib/attachments";
import { throwDbError } from "@/lib/db-error";

/** How long an issued Storage link works. */
const SIGNED_SECONDS = 60 * 60;

/**
 * Opens a chat image: checks the reader may see it, then redirects to a
 * short-lived signed Storage URL. The bytes never pass through the Worker.
 *
 * Both lookups run under the reader's own RLS, so an internal note's image is
 * a 404 to a requester here exactly as the note itself is invisible to them.
 * The redirect is cached privately for a little less than the link lives, so
 * scrolling a thread back and forth does not re-ask on every image.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireApiUser();
    const id = routeUuid((await params).id);
    const supabase = await createClient();

    const { data: attachment, error } = await supabase
      .from("ticket_attachments")
      .select("storage_path, file_name")
      .eq("id", id)
      .maybeSingle();

    if (error) throwDbError(error, "That image could not be opened.");
    if (!attachment) throw new ApiError(404, "That image does not exist, or you cannot see it.");

    const download = request.nextUrl.searchParams.get("download") === "1";
    const { data: signed, error: signError } = await supabase.storage
      .from(ATTACHMENT_BUCKET)
      .createSignedUrl(
        attachment.storage_path,
        SIGNED_SECONDS,
        download ? { download: attachment.file_name } : undefined,
      );

    if (signError || !signed?.signedUrl) {
      console.error("[attachments] sign failed", id, signError?.message);
      throw new ApiError(404, "That image is no longer available.");
    }

    return new NextResponse(null, {
      status: 302,
      headers: {
        Location: signed.signedUrl,
        "Cache-Control": `private, max-age=${SIGNED_SECONDS - 5 * 60}`,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
