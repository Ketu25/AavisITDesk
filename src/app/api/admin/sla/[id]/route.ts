import { NextResponse, type NextRequest } from "next/server";
import { apiError, requireApiAdmin } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase/server";
import { slaRuleSchema } from "@/lib/validation";
import { throwDbError } from "@/lib/db-error";

/** SLA durations are data, never constants in application code. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireApiAdmin();
    const { id } = await params;
    const body = slaRuleSchema.partial().parse(await request.json());

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("sla_rules")
      .update(body)
      .eq("id", id)
      .select("*")
      .single();

    if (error) throwDbError(error, "That SLA rule could not be updated.");
    return NextResponse.json({ rule: data });
  } catch (error) {
    return apiError(error);
  }
}
