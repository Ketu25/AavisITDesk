import { NextResponse, type NextRequest } from "next/server";
import { apiError, ApiError, requireApiUser, routeUuid } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase/server";
import { commentSchema } from "./schema";
import { attachmentTicketId } from "@/lib/attachments";
import { throwDbError } from "@/lib/db-error";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireApiUser();
    const id = routeUuid((await params).id);
    const body = commentSchema.parse(await request.json());

    if (body.is_internal && !ctx.isAgent) {
      throw new ApiError(403, "Only agents can leave internal notes.");
    }

    // Each image was uploaded into this ticket's folder. The database checks
    // it again; checking here means a mix-up reads as a sentence, not a 500.
    if (body.attachments.some((a) => attachmentTicketId(a.path) !== id)) {
      throw new ApiError(422, "One of those images belongs to a different ticket. Remove it and attach it again.");
    }

    const supabase = await createClient();

    // A closed ticket takes no further comment from anyone. RLS enforces this
    // too; checking here turns an opaque policy rejection into a message that
    // says what to do instead.
    const { data: ticket } = await supabase
      .from("tickets")
      .select("status")
      .eq("id", id)
      .maybeSingle();

    if (!ticket) throw new ApiError(404, "That ticket does not exist, or you cannot see it.");

    if (ticket.status === "closed") {
      throw new ApiError(
        409,
        ctx.isAgent
          ? "This ticket is closed. Move it back to In progress to add anything further."
          : "This ticket is closed. Please raise a new ticket if you still need help.",
      );
    }

    // One transaction for the message and its images, under the caller's own
    // RLS — see post_ticket_comment() in the migration.
    const { data, error } = await supabase.rpc("post_ticket_comment", {
      p_ticket_id: id,
      p_message: body.message,
      p_is_internal: body.is_internal ?? false,
      p_attachments: body.attachments,
    });

    if (error) {
      // Every stored image can belong to one message only. Meeting one that
      // already does means an earlier attempt at this same send went through
      // and only its response was lost — the browser keeps the uploaded paths
      // to retry with, precisely so this can be recognised rather than posted
      // twice. Nothing was written this time; the transaction rolled back.
      if (error.code === "23505" && body.attachments.length > 0) {
        throw new ApiError(409, "That message was already sent.", { reason: "already_posted" });
      }
      // The insert policy said no after the check above said yes: the ticket
      // closed in between, or the account was switched off. Postgres's own
      // wording names the table, so it is replaced rather than passed on.
      if (error.code === "42501" && /row-level security/i.test(error.message)) {
        throw new ApiError(403, "This ticket can no longer take that reply. Reload the page to see what changed.");
      }
      throwDbError(error, "The comment could not be posted.");
    }

    return NextResponse.json({ comment: data }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
