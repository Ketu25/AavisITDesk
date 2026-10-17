import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { Icons } from "@/components/shell/icons";
import { Reveal } from "@/components/motion";
import { NewTicketButton } from "@/components/tickets/new-ticket";
import { QuickTicketsBoard, type OpenReport } from "@/components/quick-tickets";
import { OPEN_STATUSES } from "@/lib/constants";
import { QUICK_ISSUE_SELECT, groupQuickIssues } from "@/lib/quick-tickets";

export const metadata: Metadata = { title: "Quick tickets" };

/**
 * Every live quick ticket, for anyone signed in, and the viewer's own reports
 * from them that are still open. Admins read hidden quick tickets through RLS
 * too, so what is live is decided in groupQuickIssues — an admin sees exactly
 * what a requester sees here, and manages the rest in setup.
 */
export default async function QuickTicketsPage() {
  const { profile, isAdmin } = await requireUser();
  const supabase = await createClient();

  const [issuesRes, openRes] = await Promise.all([
    supabase.from("quick_tickets").select(QUICK_ISSUE_SELECT).eq("is_active", true),
    // Filtered on created_by itself, not left to RLS: agents and admins can
    // read the whole desk, and only their own tickets count as "already reported".
    supabase
      .from("tickets")
      .select(
        "id, ticket_number, subject, status, created_at, quick_ticket_id, assignee:profiles!tickets_assigned_to_fkey(id, full_name)",
      )
      .eq("created_by", profile.id)
      .in("status", OPEN_STATUSES)
      .not("quick_ticket_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  if (issuesRes.error) console.error("[quick-tickets] list query failed", issuesRes.error.message);
  // Only the open-reports strip and the "already reported" hints depend on
  // this; the dialog and the API check again before anything is sent.
  if (openRes.error) console.error("[quick-tickets] open tickets query failed", openRes.error.message);

  const reports: OpenReport[] = [];
  for (const ticket of openRes.data ?? []) {
    if (!ticket.quick_ticket_id) continue;
    // PostgREST hands a many-to-one embed back as an object; an array is not worth crashing on.
    const assignee = Array.isArray(ticket.assignee) ? (ticket.assignee[0] ?? null) : ticket.assignee;
    reports.push({
      id: ticket.id,
      ticket_number: ticket.ticket_number,
      subject: ticket.subject,
      status: ticket.status,
      created_at: ticket.created_at,
      quick_ticket_id: ticket.quick_ticket_id,
      assignee: assignee ? { id: assignee.id, full_name: assignee.full_name } : null,
    });
  }

  return (
    <>
      <PageHeader
        title="Quick tickets"
        description="Common problems, already written up. Open a group, pick the problem, and send."
        actions={
          <>
            {isAdmin && (
              <Link
                href="/admin/quick-tickets"
                className="inline-flex h-8 items-center gap-1.5 rounded-[9px] px-2.5 text-[0.8125rem] font-medium text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink"
              >
                <Icons.wrench className="size-3.5" />
                Manage
              </Link>
            )}
            <NewTicketButton className="inline-flex h-8 items-center gap-1.5 rounded-[9px] border border-line-strong bg-surface px-3 text-[0.8125rem] font-medium text-ink transition-colors hover:bg-surface-hover">
              <Icons.plus className="size-3.5" />
              New ticket
            </NewTicketButton>
          </>
        }
      />
      <PageBody>
        <Reveal index={0}>
          <QuickTicketsBoard
            groups={groupQuickIssues((issuesRes.data ?? []) as unknown as Record<string, unknown>[])}
            reports={reports}
            viewerId={profile.id}
            isAdmin={isAdmin}
            failed={Boolean(issuesRes.error)}
          />
        </Reveal>
      </PageBody>
    </>
  );
}
