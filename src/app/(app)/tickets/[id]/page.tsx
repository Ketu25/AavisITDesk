import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { TicketDetail } from "@/components/tickets/ticket-detail";
import { TICKET_SELECT } from "@/lib/queries";
import type { TicketRowData } from "@/components/tickets/ticket-row";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("tickets")
    .select("ticket_number, subject")
    .eq("id", id)
    .maybeSingle();

  return { title: data ? `${data.ticket_number} · ${data.subject}` : "Ticket" };
}

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireUser();
  const supabase = await createClient();

  // RLS decides visibility: a requester sees only their own ticket.
  const { data: ticket } = await supabase
    .from("tickets")
    .select(TICKET_SELECT)
    .eq("id", id)
    .maybeSingle();

  if (!ticket) notFound();

  const [{ data: comments }, { data: events }, { data: rules }, { data: agents }] =
    await Promise.all([
      supabase
        .from("ticket_comments")
        .select("*, author:profiles(id, full_name, role)")
        .eq("ticket_id", id)
        .order("created_at"),
      supabase
        .from("ticket_events")
        .select("*, actor:profiles(id, full_name)")
        .eq("ticket_id", id)
        .order("created_at"),
      supabase.from("sla_rules").select("*"),
      ctx.isAgent
        ? supabase
            .from("profiles")
            .select("id, full_name, role")
            .in("role", ["agent", "admin"])
            .eq("status", "active")
            .order("full_name")
        : Promise.resolve({ data: [] }),
    ]);

  return (
    <TicketDetail
      ticket={ticket as unknown as TicketRowData}
      comments={comments ?? []}
      events={events ?? []}
      rules={rules ?? []}
      agents={agents ?? []}
      viewer={{
        id: ctx.userId,
        isAgent: ctx.isAgent,
        isOwner: ticket.created_by === ctx.userId,
      }}
    />
  );
}
