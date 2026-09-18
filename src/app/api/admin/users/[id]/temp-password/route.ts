import { NextResponse, type NextRequest } from "next/server";
import { apiError, ApiError, requireApiAdmin, routeUuid } from "@/lib/api-auth";
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
    const id = routeUuid((await params).id);

    if (id === ctx.userId) {
      throw new ApiError(
        422,
        "You cannot issue yourself a temporary password — it would sign you out. Use the password reset on your profile.",
      );
    }

    // No body at all is the ordinary case and means "generate one". A body
    // that is present but invalid is a different thing, and catching both
    // together quietly turned an over-long password into a generated one with
    // nothing said about it.
    const raw: unknown = await request.json().catch(() => null);
    const body = raw === null ? { password: null } : tempPasswordSchema.parse(raw);

    const issued = await issueTempPassword(id, body.password);
    return NextResponse.json({ user: issued });
  } catch (error) {
    return apiError(error);
  }
}
