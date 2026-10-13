import Link from "next/link";
import { LivePulse, Reveal } from "@/components/motion";
import { Icons } from "@/components/shell/icons";
import { DashboardList } from "./dashboard-list";
import { ActiveTickets } from "./ticket-tracker";
import { TicketHistory, type HistoryRow } from "./ticket-history";
import type { TicketRowData } from "./ticket-row";
import type { SlaRule } from "@/lib/database.types";

/** What the overview loads about the tickets the viewer raised. */
export type OwnTicketsData = {
  /** Unfinished tickets for the trackers, the viewer's move first; a handful. */
  active: TicketRowData[];
  /** Every unfinished ticket, not only the ones in `active`. */
  activeTotal: number;
  /** The most recently closed. */
  closed: TicketRowData[];
  /** Null when the history could not be read at all. */
  history: { rows: HistoryRow[]; partial: boolean } | null;
};

/**
 * On the desk view these sections sit under the queue's own, where a bare
 * "Active tickets" reads as the desk's and "Recently closed" as what the agent
 * closed, so each heading there says whose tickets it means.
 */
const HEADINGS = {
  requester: { active: "Active tickets", history: "Your history", closed: "Recently closed" },
  desk: { active: "My active tickets", history: "My ticket history", closed: "My closed tickets" },
} as const;

/**
 * Active tickets, history and recently closed, for the tickets the viewer
 * raised. A requester's whole overview; for an agent or admin, the part under
 * the desk that is about them as a requester.
 */
export function OwnTicketSections({
  data,
  rules,
  viewerId,
  zone,
  now,
  variant,
  from,
}: {
  data: OwnTicketsData;
  rules: SlaRule[];
  viewerId: string;
  /** The zone the server draws months in, until the browser's own takes over. */
  zone: string;
  now: number;
  /** "desk" under an agent's or admin's queue sections, which have no "My
   *  tickets" strip above to carry the link to the full list. */
  variant: keyof typeof HEADINGS;
  /** Where the first section falls in the page's entrance cascade. */
  from: number;
}) {
  const headings = HEADINGS[variant];

  return (
    <>
      <Reveal index={from} className="space-y-3" role="region" aria-labelledby="overview-active">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="overview-active" className="eyebrow">
            {headings.active}
          </h2>
          <div className="flex flex-none items-baseline gap-3">
            {data.activeTotal > 0 && (
              <LivePulse label="Updates live" className="text-[0.6875rem] text-[var(--spec-ok)]" />
            )}
            {variant === "desk" && (
              <Link
                href="/tickets"
                className="text-[0.75rem] text-ink-muted underline-offset-4 hover:text-ink hover:underline"
              >
                See all
              </Link>
            )}
          </div>
        </div>
        {data.activeTotal === 0 ? (
          <div data-tone="emerald" className="card flex items-center gap-3 p-4">
            <span
              className="flex size-9 flex-none items-center justify-center rounded-full"
              style={{ background: "var(--tone-bg)", color: "var(--tone-fg)" }}
            >
              <Icons.check className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="text-[0.875rem] font-medium text-ink">Nothing in progress</p>
              <p className="mt-0.5 text-[0.8125rem] text-ink-muted text-pretty">
                Everything you&apos;ve raised is closed. If something else breaks, raise a new
                ticket.
              </p>
            </div>
          </div>
        ) : (
          <ActiveTickets
            tickets={data.active}
            rules={rules}
            total={data.activeTotal}
            viewerId={viewerId}
          />
        )}
      </Reveal>

      {data.history && (
        <TicketHistory
          rows={data.history.rows}
          serverTimeZone={zone}
          serverNow={now}
          partial={data.history.partial}
          title={headings.history}
          index={from + 1}
        />
      )}

      {data.closed.length > 0 && (
        <Reveal index={from + 2} className="space-y-3" role="region" aria-labelledby="overview-closed">
          <h2 id="overview-closed" className="eyebrow">
            {headings.closed}
          </h2>
          <DashboardList tickets={data.closed} rules={rules} showAssignee />
        </Reveal>
      )}
    </>
  );
}
