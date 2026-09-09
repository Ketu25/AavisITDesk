import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { Stat } from "@/components/ui/stat";
import { Reveal, StaggerChildren } from "@/components/motion";
import { EmptyState } from "@/components/ui/states";
import { Icons } from "@/components/shell/icons";
import { DashboardList } from "@/components/tickets/dashboard-list";
import { OPEN_STATUSES } from "@/lib/constants";
import { TICKET_SELECT } from "@/lib/queries";
import { minutesToLabel } from "@/lib/format";
import type { TicketRowData } from "@/components/tickets/ticket-row";

export const metadata: Metadata = { title: "Overview" };

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default async function DashboardPage() {
  const { profile, isAgent } = await requireUser();
  const supabase = await createClient();
  const nowIso = new Date().toISOString();

  const [{ data: myTickets }, { data: rules }] = await Promise.all([
    supabase
      .from("tickets")
      .select(TICKET_SELECT)
      .eq("created_by", profile.id)
      .order("created_at", { ascending: false })
      .limit(6),
    supabase.from("sla_rules").select("*"),
  ]);

  const mine = (myTickets ?? []) as unknown as TicketRowData[];
  const myOpen = mine.filter((t) => OPEN_STATUSES.includes(t.status));
  const awaitingMe = mine.filter(
    (t) => t.status === "waiting_on_user" || t.status === "resolved",
  );

  // Agents get the queue-health strip on top of their personal view.
  let agentStats: {
    open: number;
    unassigned: number;
    breached: number;
    mine: number;
    avgResolution: number | null;
  } | null = null;
  let attention: TicketRowData[] = [];

  if (isAgent) {
    const [openRes, unassignedRes, breachedRes, mineRes, attentionRes, resolvedRes] =
      await Promise.all([
        supabase.from("tickets").select("id", { count: "exact", head: true }).in("status", OPEN_STATUSES),
        supabase
          .from("tickets")
          .select("id", { count: "exact", head: true })
          .in("status", OPEN_STATUSES)
          .is("assigned_to", null),
        supabase
          .from("tickets")
          .select("id", { count: "exact", head: true })
          .in("status", OPEN_STATUSES)
          .is("sla_paused_at", null)
          .lt("sla_due_at", nowIso),
        supabase
          .from("tickets")
          .select("id", { count: "exact", head: true })
          .in("status", OPEN_STATUSES)
          .eq("assigned_to", profile.id),
        supabase
          .from("tickets")
          .select(TICKET_SELECT)
          .in("status", OPEN_STATUSES)
          .order("sla_due_at", { ascending: true, nullsFirst: false })
          .limit(6),
        supabase
          .from("tickets")
          .select("created_at, resolved_at")
          .not("resolved_at", "is", null)
          // Server Component: one render per request, so this is deterministic.
          // eslint-disable-next-line react-hooks/purity
          .gte("created_at", new Date(Date.now() - 30 * 86400000).toISOString())
          .limit(500),
      ]);

    const durations = (resolvedRes.data ?? []).map(
      (t) => (new Date(t.resolved_at!).getTime() - new Date(t.created_at).getTime()) / 60000,
    );

    agentStats = {
      open: openRes.count ?? 0,
      unassigned: unassignedRes.count ?? 0,
      breached: breachedRes.count ?? 0,
      mine: mineRes.count ?? 0,
      avgResolution: durations.length
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : null,
    };
    attention = (attentionRes.data ?? []) as unknown as TicketRowData[];
  }

  const firstName = profile.full_name.split(/\s+/)[0];

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${firstName}`}
        description={
          isAgent
            ? "Here's the state of the desk and your own tickets."
            : "Here's where your requests stand."
        }
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

      <PageBody className="space-y-6">
        {agentStats && (
          <Reveal index={0} className="space-y-3" role="region">
            <h2 className="eyebrow">Service desk</h2>
            <StaggerChildren className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Open" value={agentStats.open} href="/queue" hint="Across all departments" />
              <Stat
                label="Unassigned"
                value={agentStats.unassigned}
                tone={agentStats.unassigned > 0 ? "amber" : undefined}
                href="/queue?assignee=unassigned"
                hint="Nobody working these yet"
              />
              <Stat
                label="SLA breached"
                value={agentStats.breached}
                tone={agentStats.breached > 0 ? "rose" : "emerald"}
                href="/queue?sla=breached"
                hint={agentStats.breached > 0 ? "Needs attention now" : "All within target"}
              />
              <Stat
                label="Assigned to me"
                value={agentStats.mine}
                href="/queue?assignee=me"
                hint={
                  agentStats.avgResolution
                    ? `Team average ${minutesToLabel(agentStats.avgResolution)} to resolve`
                    : "No resolutions in the last 30 days"
                }
              />
            </StaggerChildren>
          </Reveal>
        )}

        {isAgent && attention.length > 0 && (
          <Reveal index={1} className="space-y-3" role="region">
            <div className="flex items-baseline justify-between">
              <h2 className="eyebrow">Needs attention first</h2>
              <Link
                href="/queue"
                className="text-[0.75rem] text-ink-muted underline-offset-4 hover:text-ink hover:underline"
              >
                Open queue
              </Link>
            </div>
            <DashboardList tickets={attention} rules={rules ?? []} showRequester showAssignee />
          </Reveal>
        )}

        <Reveal index={2} className="space-y-3" role="region">
          <div className="flex items-baseline justify-between">
            <h2 className="eyebrow">My tickets</h2>
            <Link
              href="/tickets"
              className="text-[0.75rem] text-ink-muted underline-offset-4 hover:text-ink hover:underline"
            >
              See all
            </Link>
          </div>

          {!isAgent && (
            <StaggerChildren className="grid gap-3 sm:grid-cols-3">
              <Stat label="Open" value={myOpen.length} href="/tickets" />
              <Stat
                label="Waiting on you"
                value={awaitingMe.length}
                tone={awaitingMe.length > 0 ? "fuchsia" : undefined}
                hint={awaitingMe.length > 0 ? "Needs your reply or confirmation" : "Nothing pending"}
              />
              <Stat label="Raised in total" value={mine.length} />
            </StaggerChildren>
          )}

          {mine.length === 0 ? (
            <div className="card">
              <EmptyState
                icon={<Icons.inbox />}
                title="No tickets yet"
                description="When something breaks, raise a ticket and IT will pick it up from the shared queue."
                action={
                  <Link
                    href="/tickets/new"
                    className="inline-flex h-8 items-center gap-1.5 rounded-[9px] border border-line-strong bg-surface px-3 text-[0.8125rem] font-medium text-ink transition-colors hover:bg-surface-hover"
                  >
                    <Icons.plus className="size-3.5" />
                    Raise your first ticket
                  </Link>
                }
              />
            </div>
          ) : (
            <DashboardList tickets={mine} rules={rules ?? []} showAssignee />
          )}
        </Reveal>
      </PageBody>
    </>
  );
}
