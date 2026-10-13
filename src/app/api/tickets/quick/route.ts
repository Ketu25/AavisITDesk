import { NextResponse, type NextRequest } from "next/server";
import { ApiError, apiError, requireApiUser } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase/server";
import { raiseQuickTicketSchema } from "@/lib/validation";
import { throwDbError } from "@/lib/db-error";
import { OPEN_STATUSES } from "@/lib/constants";
import { QUICK_ISSUE_SELECT, composeQuickTicket, oneLine, toQuickIssue } from "@/lib/quick-tickets";

const UNAVAILABLE =
  "IT has just switched this quick ticket off. Pick another one, or raise a ticket the usual way.";

/**
 * Raises a ticket from a quick ticket the requester has just reviewed.
 *
 * The browser sends which quick ticket, the revision it showed, and what was
 * typed — never the ticket's text. The text is composed here from the template
 * as it stands, which is why the revision matters: if IT edited the template
 * while the dialog was open, the requester is shown the new version instead of
 * having it sent unseen.
 *
 * The insert trigger checks once more that the quick ticket, its group and its
 * category are all live, inside the insert itself, so one switched off between
 * this check and the row landing is still refused.
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireApiUser();
    const body = raiseQuickTicketSchema.parse(await request.json());

    const supabase = await createClient();

    const { data: row, error } = await supabase
      .from("quick_tickets")
      .select(QUICK_ISSUE_SELECT)
      .eq("id", body.quick_ticket_id)
      .maybeSingle();
    if (error) throwDbError(error, "The ticket could not be created.");

    // Admins can read hidden quick tickets, so "not found" is not enough.
    const current = toQuickIssue(row as Record<string, unknown> | null);
    if (!current) throw new ApiError(422, UNAVAILABLE, { reason: "unavailable" });

    if (current.revision !== body.revision) {
      throw new ApiError(
        409,
        "IT has just updated this quick ticket. Check what it says now, then send it.",
        { reason: "changed", issue: current },
      );
    }

    // Without a question there is nothing to answer — the dialog drops it too.
    const answer = current.detail_prompt ? oneLine(body.answer) : "";
    if (current.detail_required && !answer) {
      throw new ApiError(422, "Answer the question first — IT needs it to find the problem.", {
        field: "answer",
      });
    }

    // The same problem reported twice is usually a double send, a retry after
    // a dropped connection, or someone who forgot they already told IT. The
    // requester decides — but only after being shown the ticket that exists.
    if (!body.allow_duplicate) {
      const { data: open, error: openError } = await supabase
        .from("tickets")
        .select("id, ticket_number")
        .eq("created_by", ctx.userId)
        .eq("quick_ticket_id", current.id)
        .in("status", OPEN_STATUSES)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (openError) throwDbError(openError, "The ticket could not be created.");

      if (open) {
        throw new ApiError(
          409,
          `You already reported this as ${open.ticket_number}, and it's still open.`,
          { reason: "duplicate", ticket: open },
        );
      }
    }

    const composed = composeQuickTicket(current, { answer, note: body.note });

    const { data: ticket, error: insertError } = await supabase
      .from("tickets")
      .insert({
        created_by: ctx.userId,
        subject: composed.subject,
        description: composed.description,
        category: current.category,
        // As the admin wrote it: the trigger applies the category's default
        // the same way it does for every other ticket.
        priority: current.priority,
        quick_ticket_id: current.id,
      })
      .select("id, ticket_number, subject, priority, category")
      .single();

    if (insertError) {
      // Raised by the insert trigger: switched off since the read above.
      if (insertError.code === "22023") {
        throw new ApiError(422, UNAVAILABLE, { reason: "unavailable" });
      }
      throwDbError(insertError, "The ticket could not be created.");
    }

    return NextResponse.json({ ticket }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
