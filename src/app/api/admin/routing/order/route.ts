import { NextResponse, type NextRequest } from "next/server";
import { apiError, requireApiAdmin } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase/server";
import { routingOrderSchema } from "@/lib/validation";
import { throwDbError } from "@/lib/db-error";

/**
 * Replaces the category order in one go. The database function refuses a list
 * that is not exactly the current set of rules, so a page that went stale while
 * the admin was dragging gets told so instead of scrambling the order.
 */
export async function PUT(request: NextRequest) {
  try {
    await requireApiAdmin();
    const { ids } = routingOrderSchema.parse(await request.json());

    const supabase = await createClient();
    const { error } = await supabase.rpc("reorder_routing_rules", { p_ids: ids });
    if (error) throwDbError(error, "The new order could not be saved.");

    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
