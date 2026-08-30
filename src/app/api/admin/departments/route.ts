import { NextResponse, type NextRequest } from "next/server";
import { apiError, requireApiAdmin } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase/server";
import { departmentSchema } from "@/lib/validation";
import { throwDbError } from "@/lib/db-error";

export async function POST(request: NextRequest) {
  try {
    await requireApiAdmin();
    const body = departmentSchema.parse(await request.json());

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("departments")
      .insert({ name: body.name, sort_order: body.sort_order ?? 999 })
      .select("*")
      .single();

    if (error) throwDbError(error, "That department could not be created.");
    return NextResponse.json({ department: data }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
