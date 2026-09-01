import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, ApiError, requireApiAdmin } from "@/lib/api-auth";
import { createUserWithTempPassword, resolveDepartment } from "@/lib/provisioning";
import { USER_ROLES } from "@/lib/database.types";

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
  rows: z.array(z.record(z.string(), z.string().nullable())).min(1).max(500),
});

export type ImportResult = {
  email: string;
  status: "created" | "failed";
  name?: string;
  temp_password?: string;
  message?: string;
};

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

        const departmentId = await resolveDepartment(parsed.department);
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
