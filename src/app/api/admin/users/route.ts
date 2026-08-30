import { NextResponse, type NextRequest } from "next/server";
import { apiError, requireApiAdmin } from "@/lib/api-auth";
import { inviteUserSchema } from "@/lib/validation";
import { inviteUser, resolveDepartment } from "@/lib/provisioning";

/** Invite a single person. Admin only, allow-list enforced server-side. */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireApiAdmin();
    const body = inviteUserSchema.parse(await request.json());

    const departmentId =
      body.department_id ?? (await resolveDepartment(body.department ?? null));

    const user = await inviteUser(
      {
        email: body.email,
        full_name: body.full_name,
        role: body.role,
        department_id: departmentId,
      },
      ctx.userId,
    );

    return NextResponse.json({ user: { id: user?.id, email: body.email } }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
