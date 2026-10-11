import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, ApiError, requireApiAdmin } from "@/lib/api-auth";
import { activeDepartmentIds, createUserWithTempPassword } from "@/lib/provisioning";
import { createClient } from "@/lib/supabase/server";
import { throwDbError } from "@/lib/db-error";
import { USER_ROLES } from "@/lib/database.types";
import { departmentKey, MAX_IMPORT_ROWS, type ImportOptions } from "@/lib/people-import";

const rowSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().min(1).max(120),
  department: z.string().trim().optional().nullable(),
  role: z
    .string()
    .trim()
    .toLowerCase()
    .optional()
    .transform((v) =>
      v && USER_ROLES.includes(v as never) ? (v as (typeof USER_ROLES)[number]) : "user",
    ),
});

const bodySchema = z.object({
  rows: z.array(z.record(z.string(), z.string().nullable())).min(1).max(MAX_IMPORT_ROWS),
});

export type ImportResult = {
  email: string;
  status: "created" | "failed";
  name?: string;
  temp_password?: string;
  message?: string;
};

/**
 * What the template offers right now: active departments in the order
 * requesters see them, every role, and the allowed email domains. Read when the
 * template is downloaded, so its dropdowns are never older than that click.
 */
export async function GET() {
  try {
    await requireApiAdmin();
    const supabase = await createClient();

    const [departments, settings] = await Promise.all([
      supabase
        .from("departments")
        .select("id, name")
        .eq("is_active", true)
        .order("sort_order")
        .order("name"),
      supabase.from("app_settings").select("allowed_email_domains").maybeSingle(),
    ]);

    if (departments.error) throwDbError(departments.error, "Departments could not be loaded.");
    if (settings.error) throwDbError(settings.error, "Settings could not be loaded.");

    const options: ImportOptions = {
      departments: departments.data ?? [],
      allowedDomains: settings.data?.allowed_email_domains ?? [],
      roles: USER_ROLES,
    };
    return NextResponse.json(options);
  } catch (error) {
    return apiError(error);
  }
}

/**
 * Bulk create. Every row is attempted independently and reported back, so one
 * bad address never aborts the batch — the admin fixes those rows and re-runs.
 *
 * Each account gets its own generated temporary password, returned once so the
 * admin can distribute them. Nothing is emailed, so this is not subject to any
 * mail rate limit and a full company import runs in one pass.
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireApiAdmin();
    const { rows } = bodySchema.parse(await request.json());
    const departmentIds = await activeDepartmentIds();

    const results: ImportResult[] = [];
    const seen = new Set<string>();

    for (const raw of rows) {
      const email = (raw.email ?? "").trim().toLowerCase();

      try {
        const parsed = rowSchema.parse({
          email: raw.email,
          name: raw.name,
          department: raw.department,
          role: raw.role,
        });

        if (seen.has(parsed.email)) {
          results.push({
            email: parsed.email,
            status: "failed",
            message: "Duplicate row in this file.",
          });
          continue;
        }
        seen.add(parsed.email);

        // A template downloaded before a department was retired can still name
        // it, so only departments active right now are accepted.
        const departmentId = parsed.department
          ? departmentIds.get(departmentKey(parsed.department))
          : null;
        if (departmentId === undefined) {
          throw new ApiError(422, `There is no active department called "${parsed.department}".`);
        }

        const created = await createUserWithTempPassword(
          {
            email: parsed.email,
            full_name: parsed.name,
            role: parsed.role,
            department_id: departmentId,
          },
          ctx.userId,
        );

        results.push({
          email: created.email,
          status: "created",
          name: created.full_name,
          temp_password: created.temp_password,
        });
      } catch (error) {
        const message =
          error instanceof ApiError
            ? error.message
            : error instanceof z.ZodError
              ? error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
              : "Unexpected error.";
        results.push({ email: email || "(no email)", status: "failed", message });
      }
    }

    const created = results.filter((r) => r.status === "created").length;
    return NextResponse.json({ created, failed: results.length - created, results });
  } catch (error) {
    return apiError(error);
  }
}
