import type { Metadata } from "next";
import { requireAgent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { QueueBoard } from "@/components/queue/queue-board";
import { TICKET_SELECT } from "@/lib/queries";
import type { TicketRowData } from "@/components/tickets/ticket-row";

export const metadata: Metadata = { title: "Queue" };

export default async function QueuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requireAgent();
  const params = await searchParams;
  const supabase = await createClient();

  const [{ data: tickets }, { data: departments }, { data: agents }, { data: rules }, { data: categories }] =
    await Promise.all([
      supabase
        .from("tickets")
        .select(TICKET_SELECT)
        .order("created_at", { ascending: false })
        .limit(500),
      supabase.from("departments").select("id, name").order("sort_order"),
      supabase
        .from("profiles")
        .select("id, full_name")
        .in("role", ["agent", "admin"])
        .eq("status", "active")
        .order("full_name"),
      supabase.from("sla_rules").select("*"),
      supabase.from("routing_rules").select("category").eq("is_active", true).order("sort_order"),
    ]);

  return (
    <>
      <PageHeader
        title="Shared queue"
        description="Every department in one list — sorted by what needs attention first."
      />
      <PageBody>
        <QueueBoard
          tickets={(tickets ?? []) as unknown as TicketRowData[]}
          departments={departments ?? []}
          agents={agents ?? []}
          rules={rules ?? []}
          categories={(categories ?? []).map((c) => c.category)}
          viewerId={ctx.userId}
          initialFilters={{
            sla: params.sla ?? "",
            assignee: params.assignee ?? "",
            status: params.status ?? "",
            priority: params.priority ?? "",
            department: params.department ?? "",
          }}
        />
      </PageBody>
    </>
  );
}
