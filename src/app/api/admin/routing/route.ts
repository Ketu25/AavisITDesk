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

    // A new category goes to the bottom of the list; the admin drags it into
    // place from there. Taken from the highest number in use rather than the
    // count of rules, which collides with an existing rule once one is deleted.
    let sortOrder = body.sort_order;
    if (sortOrder === undefined) {
      const { data: last, error: lastError } = await supabase
        .from("routing_rules")
        .select("sort_order")
        .order("sort_order", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lastError) throwDbError(lastError, "That routing rule could not be created.");
      sortOrder = (last?.sort_order ?? 0) + 10;
    }

    const { data, error } = await supabase
      .from("routing_rules")
      .insert({ ...body, sort_order: sortOrder })
      .select("*")
      .single();

    if (error) throwDbError(error, "That routing rule could not be created.");
    return NextResponse.json({ rule: data }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
