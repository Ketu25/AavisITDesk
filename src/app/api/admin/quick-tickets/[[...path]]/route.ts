import type { NextRequest } from "next/server";
import { ApiError, apiError } from "@/lib/api-auth";
import { createGroup, deleteGroup, reorderGroups, updateGroup } from "../groups";
import {
  createQuickTicket,
  deleteQuickTicket,
  reorderQuickTickets,
  updateQuickTicket,
} from "../items";

/**
 * Every quick-ticket admin endpoint, behind one route file:
 *
 *   POST   /api/admin/quick-tickets               create a quick ticket
 *   PUT    /api/admin/quick-tickets/order         reorder one group's quick tickets
 *   PATCH  /api/admin/quick-tickets/:id           edit, or switch live/hidden
 *   DELETE /api/admin/quick-tickets/:id
 *   POST   /api/admin/quick-tickets/groups        create a group
 *   PUT    /api/admin/quick-tickets/groups/order  reorder the groups
 *   PATCH  /api/admin/quick-tickets/groups/:id
 *   DELETE /api/admin/quick-tickets/groups/:id
 *
 * One file rather than six because each route handler is bundled into the
 * Cloudflare Worker with its own copy of Next's route wrapper — about 4.5 KiB
 * gzipped apiece, on a Worker already near its 3 MiB limit. The URLs are the
 * same either way. Each handler checks the caller is an admin itself.
 */

type Context = { params: Promise<{ path?: string[] }> };

const notFound = () => apiError(new ApiError(404, "There is nothing at that address."));

export async function POST(request: NextRequest, { params }: Context) {
  const path = (await params).path ?? [];
  if (path.length === 0) return createQuickTicket(request);
  if (path.length === 1 && path[0] === "groups") return createGroup(request);
  return notFound();
}

export async function PUT(request: NextRequest, { params }: Context) {
  const path = (await params).path ?? [];
  if (path.length === 1 && path[0] === "order") return reorderQuickTickets(request);
  if (path.length === 2 && path[0] === "groups" && path[1] === "order") return reorderGroups(request);
  return notFound();
}

export async function PATCH(request: NextRequest, { params }: Context) {
  const path = (await params).path ?? [];
  if (path.length === 1 && path[0] !== "groups" && path[0] !== "order") {
    return updateQuickTicket(request, path[0]);
  }
  if (path.length === 2 && path[0] === "groups") return updateGroup(request, path[1]);
  return notFound();
}

export async function DELETE(_request: NextRequest, { params }: Context) {
  const path = (await params).path ?? [];
  if (path.length === 1 && path[0] !== "groups" && path[0] !== "order") {
    return deleteQuickTicket(path[0]);
  }
  if (path.length === 2 && path[0] === "groups") return deleteGroup(path[1]);
  return notFound();
}
