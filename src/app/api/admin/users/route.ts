import { NextResponse, type NextRequest } from "next/server";
import { apiError, requireApiAdmin } from "@/lib/api-auth";
import { inviteUserSchema } from "@/lib/validation";
import {
  createUserWithTempPassword,
  inviteUser,
  resolveDepartment,
} from "@/lib/provisioning";

/**
 * Creates one account. Admin only, allow-list enforced server-side.
 *
 * Default delivery is a temporary password handed over out of band, because
 * Supabase's built-in mailer caps auth email at roughly two an hour — far too
 * few to onboard a company. Email invites remain available as a fallback.
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireApiAdmin();
    const body = inviteUserSchema.parse(await request.json());

    const departmentId =
      body.department_id ?? (await resolveDepartment(body.department ?? null));

    if (body.delivery === "email_invite") {
      const user = await inviteUser(
        {
          email: body.email,
          full_name: body.full_name,
          role: body.role,
          department_id: departmentId,
        },
        ctx.userId,
      );
      return NextResponse.json(
        { delivery: "email_invite", user: { id: user?.id, email: body.email } },
        { status: 201 },
      );
    }

    const created = await createUserWithTempPassword(
      {
        email: body.email,
        full_name: body.full_name,
        role: body.role,
        department_id: departmentId,
        password: body.password,
      },
      ctx.userId,
    );

    // The password is returned exactly once. It is never stored in plaintext,
    // so if the admin loses it they issue a new one rather than recovering it.
    return NextResponse.json({ delivery: "temp_password", user: created }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
