import { NextResponse, type NextRequest } from "next/server";
import { apiError, ApiError, requireApiAdmin } from "@/lib/api-auth";
import { issueTempPassword } from "@/lib/provisioning";
import { tempPasswordSchema } from "@/lib/validation";

/**
 * Issues a fresh temporary password for an existing account — the path for a
 * forgotten password when email is rate limited, or for an expired one.
 *
 * The account drops back to pending and every existing session is revoked, so
 * a leaked password cannot be used to keep a session alive.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireApiAdmin();
    const { id } = await params;

    if (id === ctx.userId) {
      throw new ApiError(
        422,
        "You cannot issue yourself a temporary password — it would sign you out. Use the password reset on your profile.",
      );
    }

    const body = await request
      .json()
      .then((raw) => tempPasswordSchema.parse(raw))
      .catch(() => ({ password: null as string | null }));

    const issued = await issueTempPassword(id, body.password);
    return NextResponse.json({ user: issued });
  } catch (error) {
    return apiError(error);
  }
}
