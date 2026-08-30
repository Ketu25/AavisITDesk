import { NextResponse, type NextRequest } from "next/server";
import { apiError, requireApiAdmin } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase/server";
import { routingRuleSchema } from "@/lib/validation";
import { throwDbError } from "@/lib/db-error";

export async function POST(request: NextRequest) {
  try {
    await requireApiAdmin();
    const body = routingRuleSchema.parse(await request.json());

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("routing_rules")
      .insert({ ...body, sort_order: body.sort_order ?? 999 })
      .select("*")
      .single();

    if (error) throwDbError(error, "That routing rule could not be created.");
    return NextResponse.json({ rule: data }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
