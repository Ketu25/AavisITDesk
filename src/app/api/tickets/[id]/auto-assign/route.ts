import { NextResponse, type NextRequest } from "next/server";
import { apiError, ApiError, requireApiAgent } from "@/lib/api-auth";
import { createAdminClient, hasServiceRoleKey } from "@/lib/supabase/admin";

/**
 * Runs the configured strategy (routing rule -> least-busy / round-robin).
 * The RPC is not granted to `authenticated`, so it is invoked with the service
 * role only after this route has confirmed the caller is an agent.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireApiAgent();
    const { id } = await params;

    if (!hasServiceRoleKey()) {
      throw new ApiError(503, "Auto-assignment needs SUPABASE_SERVICE_ROLE_KEY to be configured.");
    }

    const admin = createAdminClient();
    const { data, error } = await admin.rpc("auto_assign_ticket", { p_ticket_id: id });

    if (error) throw new ApiError(400, error.message);
    if (!data) {
      throw new ApiError(
        409,
        "No eligible agent was found. Check that auto-assignment is enabled and at least one agent is active.",
      );
    }

    return NextResponse.json({ assigned_to: data });
  } catch (error) {
    return apiError(error);
  }
}
