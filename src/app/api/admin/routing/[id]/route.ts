import { NextResponse, type NextRequest } from "next/server";
import { apiError, ApiError, requireApiAdmin } from "@/lib/api-auth";
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
    const { id } = await params;
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
    const { id } = await params;

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
    }

    const supabase = await createClient();
    const { error } = await supabase.from("routing_rules").delete().eq("id", id);
    if (error) throwDbError(error, "That routing rule could not be removed.");

    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
