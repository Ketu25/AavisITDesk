import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, ApiError, requireApiAdmin } from "@/lib/api-auth";
import { inviteUser, resolveDepartment } from "@/lib/provisioning";
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
    .transform((v) => (v && USER_ROLES.includes(v as never) ? (v as (typeof USER_ROLES)[number]) : "user")),
});

const bodySchema = z.object({
  rows: z.array(z.record(z.string(), z.string().nullable())).min(1).max(500),
});

export type ImportResult = {
  email: string;
  status: "invited" | "failed";
  message?: string;
};

/**
 * Bulk invite. Every row is attempted independently and reported back, so one
 * bad address never aborts the batch — the admin fixes those rows and re-runs.
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
        await inviteUser(
          {
            email: parsed.email,
            full_name: parsed.name,
            role: parsed.role,
            department_id: departmentId,
          },
          ctx.userId,
        );

        results.push({ email: parsed.email, status: "invited" });
      } catch (error) {
        const message =
          error instanceof ApiError
            ? error.message
            : error instanceof z.ZodError
              ? error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
              : "Unexpected error.";
        results.push({ email: email || "(no email)", status: "failed", message });

        // The mail rate limit will reject everything after it; stop early and
        // tell the admin rather than producing 90 identical failures.
        if (error instanceof ApiError && error.status === 429) {
          results.push({
            email: "—",
            status: "failed",
            message: "Stopped early: remaining rows were not attempted.",
          });
          break;
        }
      }
    }

    const invited = results.filter((r) => r.status === "invited").length;
    return NextResponse.json({ invited, failed: results.length - invited, results });
  } catch (error) {
    return apiError(error);
  }
}
