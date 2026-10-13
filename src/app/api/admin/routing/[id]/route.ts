import { NextResponse, type NextRequest } from "next/server";
import { apiError, ApiError, requireApiAdmin, routeUuid } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { routingRuleSchema } from "@/lib/validation";
import { throwDbError } from "@/lib/db-error";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireApiAdmin();
    const id = routeUuid((await params).id);
    const body = routingRuleSchema.partial().parse(await request.json());

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("routing_rules")
      .update(body)
      .eq("id", id)
      .select("*")
      .single();

    if (error) throwDbError(error, "That routing rule could not be updated.");
    return NextResponse.json({ rule: data });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireApiAdmin();
    const id = routeUuid((await params).id);

    const admin = createAdminClient();
    const { data: rule } = await admin
      .from("routing_rules")
      .select("category")
      .eq("id", id)
      .maybeSingle();

    if (rule) {
      const { count } = await admin
        .from("tickets")
        .select("id", { count: "exact", head: true })
        .eq("category", rule.category);

      if ((count ?? 0) > 0) {
        throw new ApiError(
          409,
          `${count} existing ticket${count === 1 ? " uses" : "s use"} the "${rule.category}" ` +
            "category. Deactivate the rule instead — it disappears from the new-ticket form " +
            "but existing tickets keep their category.",
        );
      }

      // Quick tickets point at the rule itself; the foreign key refuses the
      // delete either way, and this says what to do about it.
      const { count: quick } = await admin
        .from("quick_tickets")
        .select("id", { count: "exact", head: true })
        .eq("routing_rule_id", id);

      if ((quick ?? 0) > 0) throw quickTicketsInUse(rule.category, quick ?? 0);
    }

    const supabase = await createClient();
    const { error } = await supabase.from("routing_rules").delete().eq("id", id);
    if (error) {
      // A quick ticket added to this category since the count above.
      if (error.code === "23503" && rule) throw quickTicketsInUse(rule.category, null);
      throwDbError(error, "That routing rule could not be removed.");
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}

function quickTicketsInUse(category: string, count: number | null) {
  const subject =
    count === null
      ? "Quick tickets use"
      : `${count} quick ticket${count === 1 ? " uses" : "s use"}`;
  return new ApiError(
    409,
    `${subject} the "${category}" category. Move ${count === 1 ? "it" : "them"} to another ` +
      "category in Quick tickets first, or deactivate this rule instead.",
  );
}
