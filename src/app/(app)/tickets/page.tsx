import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { MyTickets } from "@/components/tickets/my-tickets";
import { Icons } from "@/components/shell/icons";
import { TICKET_SELECT } from "@/lib/queries";
import type { TicketRowData } from "@/components/tickets/ticket-row";

export const metadata: Metadata = { title: "My tickets" };

export default async function MyTicketsPage() {
  const { profile } = await requireUser();
  const supabase = await createClient();

  const [{ data: tickets }, { data: rules }] = await Promise.all([
    supabase
      .from("tickets")
      .select(TICKET_SELECT)
      .eq("created_by", profile.id)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase.from("sla_rules").select("*"),
  ]);

  return (
    <>
      <PageHeader
        title="My tickets"
        description="Everything you've raised, newest first."
        actions={
          <Link
            href="/tickets/new"
            className="inline-flex h-8 items-center gap-1.5 rounded-[9px] bg-accent px-3 text-[0.8125rem] font-medium text-[var(--accent-ink)] transition-[filter] hover:brightness-110"
          >
            <Icons.plus className="size-3.5" />
            New ticket
          </Link>
        }
      />
      <PageBody>
        <MyTickets
          tickets={(tickets ?? []) as unknown as TicketRowData[]}
          rules={rules ?? []}
        />
      </PageBody>
    </>
  );
}
