import { NextResponse, type NextRequest } from "next/server";
import { ApiError, apiError, requireApiAdmin, routeUuid } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase/server";
import {
  QUICK_TICKET_CONTENT_FIELDS,
  quickTicketCreateSchema,
  quickTicketOrderSchema,
  quickTicketUpdateSchema,
} from "@/lib/validation";
import { throwDbError } from "@/lib/db-error";
import { quickTicketWriteError } from "./errors";

const GONE = "That quick ticket no longer exists. The page has been reloaded.";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Past the highest number in the group: a new or moved quick ticket joins the bottom. */
async function nextSortOrder(supabase: Supabase, groupId: string, failure: string) {
  const { data: last, error } = await supabase
    .from("quick_tickets")
    .select("sort_order")
    .eq("group_id", groupId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throwDbError(error, failure);
  return (last?.sort_order ?? 0) + 10;
}

/** POST /api/admin/quick-tickets */
export async function createQuickTicket(request: NextRequest) {
  try {
    await requireApiAdmin();
    const body = quickTicketCreateSchema.parse(await request.json());

    const supabase = await createClient();
    const failure = "That quick ticket could not be created.";
    const sortOrder = await nextSortOrder(supabase, body.group_id, failure);

    const { data, error } = await supabase
      .from("quick_tickets")
      .insert({ ...body, sort_order: sortOrder })
      .select("*")
      .single();

    if (error) {
      const known = quickTicketWriteError(error, body.label);
      if (known) throw known;
      throwDbError(error, failure);
    }
    return NextResponse.json({ quickTicket: data }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}

/**
 * PATCH /api/admin/quick-tickets/:id
 *
 * A change to anything a requester reads must name the revision it was made
 * against, and lands only if that is still the current one — otherwise two
 * admins editing at once would silently undo each other. Switching it live or
 * hidden carries no revision: it cannot conflict with an edit.
 */
export async function updateQuickTicket(request: NextRequest, rawId: string) {
  try {
    await requireApiAdmin();
    const id = routeUuid(rawId);
    const { expected_revision, ...changes } = quickTicketUpdateSchema.parse(await request.json());

    const patch = Object.fromEntries(
      Object.entries(changes).filter(([, value]) => value !== undefined),
    ) as typeof changes & { sort_order?: number };
    const touchesContent = QUICK_TICKET_CONTENT_FIELDS.some((field) => field in patch);

    if (touchesContent && expected_revision === undefined) {
      throw new ApiError(422, "Reload the page and make the change again.");
    }

    const supabase = await createClient();
    const failure = "That quick ticket could not be updated.";

    const { data: current, error: currentError } = await supabase
      .from("quick_tickets")
      .select("group_id, detail_prompt, detail_required")
      .eq("id", id)
      .maybeSingle();
    if (currentError) throwDbError(currentError, failure);
    if (!current) throw new ApiError(404, GONE);

    // Checked against what the row will hold, not just what was sent: a
    // required answer needs a question, whichever of the two is changing.
    const prompt = "detail_prompt" in patch ? patch.detail_prompt : current.detail_prompt;
    const required = "detail_required" in patch ? patch.detail_required : current.detail_required;
    if (required && !prompt) {
      throw new ApiError(422, "Write the question first, or don't require an answer.", {
        field: "detail_required",
      });
    }

    if (patch.group_id && patch.group_id !== current.group_id) {
      patch.sort_order = await nextSortOrder(supabase, patch.group_id, failure);
    }

    let update = supabase.from("quick_tickets").update(patch).eq("id", id);
    if (touchesContent) update = update.eq("revision", expected_revision!);
    const { data, error } = await update.select("*").maybeSingle();

    if (error) {
      const known = quickTicketWriteError(error, patch.label);
      if (known) throw known;
      throwDbError(error, failure);
    }

    if (!data) {
      // Either it is gone, or someone else saved first.
      const { data: still } = await supabase
        .from("quick_tickets")
        .select("id")
        .eq("id", id)
        .maybeSingle();
      if (!still) throw new ApiError(404, GONE);
      throw new ApiError(
        409,
        "Someone else saved changes to this quick ticket while you were editing it. " +
          "Load their version, then make your change again.",
        { reason: "conflict" },
      );
    }

    return NextResponse.json({ quickTicket: data });
  } catch (error) {
    return apiError(error);
  }
}

/**
 * DELETE /api/admin/quick-tickets/:id
 *
 * Removes a quick ticket nobody has used. One that has raised tickets is
 * hidden instead, so those tickets keep their link — the foreign key refuses
 * the delete regardless; the count here is what makes it a sentence.
 */
export async function deleteQuickTicket(rawId: string) {
  try {
    await requireApiAdmin();
    const id = routeUuid(rawId);

    const supabase = await createClient();

    const { count, error: countError } = await supabase
      .from("tickets")
      .select("id", { count: "exact", head: true })
      .eq("quick_ticket_id", id);
    if (countError) throwDbError(countError, "That quick ticket could not be removed.");
    if ((count ?? 0) > 0) throw quickTicketInUse(count ?? 0);

    const { data: removed, error } = await supabase
      .from("quick_tickets")
      .delete()
      .eq("id", id)
      .select("id");
    if (error) {
      if (error.code === "23503") throw quickTicketInUse(null);
      throwDbError(error, "That quick ticket could not be removed.");
    }
    if (!removed || removed.length === 0) throw new ApiError(404, GONE);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}

/** PUT /api/admin/quick-tickets/order — one group's quick tickets, as a whole list. */
export async function reorderQuickTickets(request: NextRequest) {
  try {
    await requireApiAdmin();
    const { group_id, ids } = quickTicketOrderSchema.parse(await request.json());

    const supabase = await createClient();
    const { error } = await supabase.rpc("reorder_quick_tickets", {
      p_group_id: group_id,
      p_ids: ids,
    });
    if (error) throwDbError(error, "The new order could not be saved.");

    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}

function quickTicketInUse(count: number | null) {
  const raised =
    count === null
      ? "Tickets have been raised"
      : `${count} ticket${count === 1 ? " was" : "s were"} raised`;
  return new ApiError(
    409,
    `${raised} from this quick ticket. Hide it instead — requesters stop seeing it, ` +
      "and those tickets keep their link.",
  );
}
