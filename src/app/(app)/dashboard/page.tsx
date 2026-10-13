import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { Greeting } from "@/components/shell/greeting";
import { Stat } from "@/components/ui/stat";
import { Reveal, StaggerChildren } from "@/components/motion";
import { EmptyState } from "@/components/ui/states";
import { Icons } from "@/components/shell/icons";
import { DashboardList } from "@/components/tickets/dashboard-list";
import { NewTicketButton } from "@/components/tickets/new-ticket";
import { OwnTicketSections } from "@/components/tickets/own-tickets";
import type { HistoryRow } from "@/components/tickets/ticket-history";
import { OPEN_STATUSES } from "@/lib/constants";
import { TICKET_SELECT } from "@/lib/queries";
import { minutesToLabel } from "@/lib/format";
import { TZ_COOKIE, dayPart, hourIn, safeTimeZone } from "@/lib/timezone";
import type { TicketRowData } from "@/components/tickets/ticket-row";
import type { TicketStatus } from "@/lib/database.types";

export const metadata: Metadata = { title: "Overview" };

/** Unfinished tickets drawn as trackers. More than this and the overview turns
 *  into the list it is meant to summarise; the rest are a link away. */
const TRACKER_LIMIT = 4;

/** Finished tickets listed under the trackers. */
const CLOSED_LIMIT = 5;

/** The desk's open tickets nearest their SLA, on the agent view. */
const ATTENTION_LIMIT = 6;

/** Statuses where the next move is the requester's: a question to answer, or a
 *  fix to confirm. These trackers lead. */
const NEEDS_REQUESTER: TicketStatus[] = ["waiting_on_user", "resolved"];

/** Unfinished and with IT. Together with the above, every status but closed. */
const WITH_IT: TicketStatus[] = OPEN_STATUSES.filter((status) => status !== "waiting_on_user");

/** Twelve months plus slack, so the reader's months are covered whatever their
 *  zone; the history card trims to the exact window itself. */
const HISTORY_DAYS = 400;
const HISTORY_PAGE = 1000;
/** A ceiling on the round trips, not a size anyone is expected to reach. */
const HISTORY_MAX_PAGES = 10;

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Every ticket the viewer raised in the history window, three columns each.
 *
 * Paged rather than fetched in one go because PostgREST caps a response at its
 * `max-rows` without saying so — the same silent ceiling that once stopped
 * "Raised in total" at six. The exact count from the first page is what says
 * whether the pages add up to the whole history.
 */
async function loadHistory(supabase: Supabase, userId: string, sinceIso: string) {
  const rows: HistoryRow[] = [];
  let total: number | null = null;

  for (let page = 0; page < HISTORY_MAX_PAGES; page++) {
    const { data, count, error } = await supabase
      .from("tickets")
      .select("created_at, category, resolved_at", page === 0 ? { count: "exact" } : undefined)
      .eq("created_by", userId)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      // A tiebreak, so two tickets raised in the same instant cannot swap
      // places between pages and be counted twice or not at all.
      .order("id", { ascending: true })
      .range(rows.length, rows.length + HISTORY_PAGE - 1);

    if (error) {
      console.error("[overview] history query failed", error.message);
      return rows.length > 0 ? { rows, partial: true } : null;
    }

    if (page === 0) total = count;
    rows.push(...(data ?? []));
    if (!data || data.length === 0 || (total !== null && rows.length >= total)) break;
  }

  return { rows, partial: total !== null && rows.length < total };
}

/**
 * The tickets the viewer raised: trackers for the unfinished ones, the latest
 * closed, and a year of history. Requesters see only this; agents and admins
 * see it under the desk.
 *
 * Every query filters on `created_by` itself, never on row-level security
 * alone: agents and admins can read the whole desk, so a query left to the
 * policy would quietly turn an agent's history into everyone's.
 */
async function loadOwnTickets(
  supabase: Supabase,
  userId: string,
  historySince: string,
  { countOpen }: { countOpen: boolean },
) {
  // Counted in the database rather than off a capped list: filtering a preview
  // is how "Raised in total" once stopped at six.
  const countMine = () =>
    supabase.from("tickets").select("id", { count: "exact", head: true }).eq("created_by", userId);

  // Rows for the trackers plus the exact size of each group, in one request.
  const unfinished = (statuses: TicketStatus[]) =>
    supabase
      .from("tickets")
      .select(TICKET_SELECT, { count: "exact" })
      .eq("created_by", userId)
      .in("status", statuses)
      .order("updated_at", { ascending: false })
      .limit(TRACKER_LIMIT);

  const [totalRes, openRes, needsYouRes, withItRes, closedRes, history] = await Promise.all([
    countMine(),
    // Only the requester's stat strip shows it; the desk view has its own.
    countOpen ? countMine().in("status", OPEN_STATUSES) : null,
    unfinished(NEEDS_REQUESTER),
    unfinished(WITH_IT),
    supabase
      .from("tickets")
      .select(TICKET_SELECT)
      .eq("created_by", userId)
      .eq("status", "closed")
      .order("closed_at", { ascending: false, nullsFirst: false })
      .limit(CLOSED_LIMIT),
    loadHistory(supabase, userId, historySince),
  ]);

  const needsYou = (needsYouRes.data ?? []) as unknown as TicketRowData[];
  const withIt = (withItRes.data ?? []) as unknown as TicketRowData[];

  return {
    total: totalRes.count ?? 0,
    open: openRes?.count ?? 0,
    awaiting: needsYouRes.count ?? needsYou.length,
    // The requester's move first, then what IT is holding; each newest-changed
    // first.
    active: [...needsYou, ...withIt].slice(0, TRACKER_LIMIT),
    activeTotal: (needsYouRes.count ?? needsYou.length) + (withItRes.count ?? withIt.length),
    closed: (closedRes.data ?? []) as unknown as TicketRowData[],
    history,
  };
}

/** The shared queue at a glance, for agents and admins: the health strip and the
 *  open tickets nearest their SLA. */
async function loadDesk(supabase: Supabase, userId: string, now: Date) {
  const nowIso = now.toISOString();

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
        .eq("assigned_to", userId),
      supabase
        .from("tickets")
        .select(TICKET_SELECT)
        .in("status", OPEN_STATUSES)
        .order("sla_due_at", { ascending: true, nullsFirst: false })
        .limit(ATTENTION_LIMIT),
      supabase
        .from("tickets")
        .select("created_at, resolved_at")
        .not("resolved_at", "is", null)
        .gte("created_at", new Date(now.getTime() - 30 * 86400000).toISOString())
        .limit(500),
    ]);

  const durations = (resolvedRes.data ?? []).map(
    (t) => (new Date(t.resolved_at!).getTime() - new Date(t.created_at).getTime()) / 60000,
  );

  return {
    stats: {
      open: openRes.count ?? 0,
      unassigned: unassignedRes.count ?? 0,
      breached: breachedRes.count ?? 0,
      mine: mineRes.count ?? 0,
      avgResolution: durations.length
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : null,
    },
    attention: (attentionRes.data ?? []) as unknown as TicketRowData[],
  };
}

export default async function DashboardPage() {
  const { profile, isAgent } = await requireUser();
  const supabase = await createClient();
  const now = new Date();
  const zone = safeTimeZone((await cookies()).get(TZ_COOKIE)?.value);

  // One round of queries for every role. The desk's run beside the viewer's own
  // rather than after them, so paging a long history never holds up the queue.
  const [{ data: rules }, own, desk] = await Promise.all([
    supabase.from("sla_rules").select("*"),
    loadOwnTickets(
      supabase,
      profile.id,
      new Date(now.getTime() - HISTORY_DAYS * 86_400_000).toISOString(),
      { countOpen: !isAgent },
    ),
    isAgent ? loadDesk(supabase, profile.id, now) : null,
  ]);

  const firstName = profile.full_name.trim().split(/\s+/)[0] || profile.full_name;

  const raiseFirst = (
    <div className="card">
      <EmptyState
        icon={<Icons.inbox />}
        title="No tickets yet"
        description="When something breaks, raise a ticket and IT will pick it up from the shared queue."
        action={
          <NewTicketButton
            className="inline-flex h-8 items-center gap-1.5 rounded-[9px] border border-line-strong bg-surface px-3 text-[0.8125rem] font-medium text-ink transition-colors hover:bg-surface-hover"
          >
            <Icons.plus className="size-3.5" />
            Raise your first ticket
          </NewTicketButton>
        }
      />
    </div>
  );

  return (
    <>
      <PageHeader
        title={
          <Greeting
            name={firstName}
            serverPart={zone ? dayPart(hourIn(zone, now.getTime())) : null}
          />
        }
        description={
          isAgent
            ? "Here's the state of the desk and your own tickets."
            : "Here's where your requests stand."
        }
        actions={
          <NewTicketButton className="inline-flex h-8 items-center gap-1.5 rounded-[9px] bg-accent px-3 text-[0.8125rem] font-medium text-[var(--accent-ink)] transition-[filter] hover:brightness-110">
            <Icons.plus className="size-3.5" />
            New ticket
          </NewTicketButton>
        }
      />

      <PageBody className="space-y-6">
        {desk && (
          <>
            <Reveal index={0} className="space-y-3" role="region">
              <h2 className="eyebrow">Service desk</h2>
              <StaggerChildren className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label="Open" value={desk.stats.open} href="/queue" hint="Across all departments" />
                <Stat
                  label="Unassigned"
                  value={desk.stats.unassigned}
                  tone={desk.stats.unassigned > 0 ? "amber" : undefined}
                  href="/queue?assignee=unassigned"
                  hint="Nobody working these yet"
                />
                <Stat
                  label="SLA breached"
                  value={desk.stats.breached}
                  tone={desk.stats.breached > 0 ? "rose" : "emerald"}
                  href="/queue?sla=breached"
                  hint={desk.stats.breached > 0 ? "Needs attention now" : "All within target"}
                />
                <Stat
                  label="Assigned to me"
                  value={desk.stats.mine}
                  href="/queue?assignee=me"
                  hint={
                    desk.stats.avgResolution
                      ? `Team average ${minutesToLabel(desk.stats.avgResolution)} to resolve`
                      : "No resolutions in the last 30 days"
                  }
                />
              </StaggerChildren>
            </Reveal>

            {desk.attention.length > 0 && (
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
                <DashboardList
                  tickets={desk.attention}
                  rules={rules ?? []}
                  showRequester
                  showAssignee
                />
              </Reveal>
            )}

            {/* The agent or admin as a requester: the same trackers and history
                a requester gets, without a second stat strip under the desk's. */}
            {own.total === 0 ? (
              <Reveal index={2} className="space-y-3" role="region" aria-labelledby="overview-mine">
                <h2 id="overview-mine" className="eyebrow">
                  My tickets
                </h2>
                {raiseFirst}
              </Reveal>
            ) : (
              <OwnTicketSections
                data={own}
                rules={rules ?? []}
                viewerId={profile.id}
                zone={zone ?? "UTC"}
                now={now.getTime()}
                variant="desk"
                from={2}
              />
            )}
          </>
        )}

        {!desk && (
          <>
            <Reveal index={0} className="space-y-3" role="region" aria-labelledby="overview-mine">
              <div className="flex items-baseline justify-between">
                <h2 id="overview-mine" className="eyebrow">
                  My tickets
                </h2>
                <Link
                  href="/tickets"
                  className="text-[0.75rem] text-ink-muted underline-offset-4 hover:text-ink hover:underline"
                >
                  See all
                </Link>
              </div>
              <StaggerChildren className="grid gap-3 sm:grid-cols-3">
                <Stat label="Open" value={own.open} href="/tickets" hint="Still being worked on" />
                <Stat
                  label="Waiting on you"
                  value={own.awaiting}
                  tone={own.awaiting > 0 ? "fuchsia" : undefined}
                  hint={own.awaiting > 0 ? "Needs your reply or confirmation" : "Nothing pending"}
                />
                <Stat label="Raised in total" value={own.total} hint="Since you joined" />
              </StaggerChildren>
            </Reveal>

            {own.total === 0 ? (
              <Reveal index={1}>{raiseFirst}</Reveal>
            ) : (
              <OwnTicketSections
                data={own}
                rules={rules ?? []}
                viewerId={profile.id}
                zone={zone ?? "UTC"}
                now={now.getTime()}
                variant="requester"
                from={1}
              />
            )}
          </>
        )}
      </PageBody>
    </>
  );
}
