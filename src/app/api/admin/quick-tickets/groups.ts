import { NextResponse, type NextRequest } from "next/server";
import { ApiError, apiError, requireApiAdmin, routeUuid } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase/server";
import {
  quickGroupOrderSchema,
  quickTicketGroupSchema,
  quickTicketGroupUpdateSchema,
} from "@/lib/validation";
import { throwDbError } from "@/lib/db-error";
import { guessIcon } from "@/lib/quick-tickets";

const GONE = "That group no longer exists. The page has been reloaded.";

/** POST /api/admin/quick-tickets/groups */
export async function createGroup(request: NextRequest) {
  try {
    await requireApiAdmin();
    const body = quickTicketGroupSchema.parse(await request.json());

    const supabase = await createClient();

    // A new group goes to the bottom, numbered past the highest in use — not
    // the count, which collides with an existing group once one is deleted.
    const { data: last, error: lastError } = await supabase
      .from("quick_ticket_groups")
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastError) throwDbError(lastError, "That group could not be created.");

    const { data, error } = await supabase
      .from("quick_ticket_groups")
      .insert({
        name: body.name,
        description: body.description ?? null,
        icon: body.icon ?? guessIcon(body.name),
        is_active: body.is_active ?? true,
        sort_order: (last?.sort_order ?? 0) + 10,
      })
      .select("*")
      .single();

    if (error) {
      if (error.code === "23505") throw nameTaken(body.name);
      throwDbError(error, "That group could not be created.");
    }
    return NextResponse.json({ group: data }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}

/** PATCH /api/admin/quick-tickets/groups/:id */
export async function updateGroup(request: NextRequest, rawId: string) {
  try {
    await requireApiAdmin();
    const id = routeUuid(rawId);
    const body = quickTicketGroupUpdateSchema.parse(await request.json());

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("quick_ticket_groups")
      .update(body)
      .eq("id", id)
      .select("*")
      .maybeSingle();

    if (error) {
      if (error.code === "23505") throw nameTaken(body.name ?? "");
      throwDbError(error, "That group could not be updated.");
    }
    if (!data) throw new ApiError(404, GONE);
    return NextResponse.json({ group: data });
  } catch (error) {
    return apiError(error);
  }
}

/**
 * DELETE /api/admin/quick-tickets/groups/:id
 *
 * Removes a group and the quick tickets in it — unless any of them has raised
 * a ticket. Those keep a link to where they came from, so the group is hidden
 * instead, the same rule routing categories follow. The foreign key enforces
 * it regardless; the count here is what turns it into a sentence.
 */
export async function deleteGroup(rawId: string) {
  try {
    await requireApiAdmin();
    const id = routeUuid(rawId);

    const supabase = await createClient();

    const { data: items, error: itemsError } = await supabase
      .from("quick_tickets")
      .select("id")
      .eq("group_id", id);
    if (itemsError) throwDbError(itemsError, "That group could not be removed.");

    const ids = (items ?? []).map((item) => item.id);
    if (ids.length > 0) {
      const { count, error: countError } = await supabase
        .from("tickets")
        .select("id", { count: "exact", head: true })
        .in("quick_ticket_id", ids);
      if (countError) throwDbError(countError, "That group could not be removed.");
      if ((count ?? 0) > 0) throw groupInUse(count ?? 0);
    }

    const { data: removed, error } = await supabase
      .from("quick_ticket_groups")
      .delete()
      .eq("id", id)
      .select("id");
    if (error) {
      // A ticket raised from one of its quick tickets since the count above.
      if (error.code === "23503") throw groupInUse(null);
      throwDbError(error, "That group could not be removed.");
    }
    if (!removed || removed.length === 0) throw new ApiError(404, GONE);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}

/**
 * PUT /api/admin/quick-tickets/groups/order
 *
 * Replaces the group order in one go. The database function refuses a list
 * that is not exactly the current set of groups, so a page that went stale
 * while the admin was reordering gets told so instead of scrambling the order.
 */
export async function reorderGroups(request: NextRequest) {
  try {
    await requireApiAdmin();
    const { ids } = quickGroupOrderSchema.parse(await request.json());

    const supabase = await createClient();
    const { error } = await supabase.rpc("reorder_quick_ticket_groups", { p_ids: ids });
    if (error) throwDbError(error, "The new order could not be saved.");

    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}

function nameTaken(name: string) {
  return new ApiError(409, `There is already a group called “${name}”.`, { field: "name" });
}

function groupInUse(count: number | null) {
  const raised =
    count === null
      ? "Tickets have been raised"
      : `${count} ticket${count === 1 ? " was" : "s were"} raised`;
  return new ApiError(
    409,
    `${raised} from quick tickets in this group. Hide the group instead — requesters stop ` +
      "seeing it, and those tickets keep their link.",
  );
}
