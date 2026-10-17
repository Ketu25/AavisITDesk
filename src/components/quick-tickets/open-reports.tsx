"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { TimeAgo } from "@/components/ui/time-ago";
import { stageOf } from "@/components/tickets/ticket-tracker";
import { ease, spring } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { TicketStatus } from "@/lib/database.types";
import type { QuickTicketIcon } from "@/lib/constants";
import { QuickIcon } from "./icon";

/** One of the viewer's unfinished tickets that came from a quick ticket. */
export type OpenReport = {
  id: string;
  ticket_number: string;
  subject: string;
  status: TicketStatus;
  created_at: string;
  quick_ticket_id: string;
  assignee: { id: string; full_name: string } | null;
};

/** One row's worth on a wide screen; the rest are a link away. */
const SHOWN = 4;

/** The stations of a ticket's life, as the overview's tracker draws them. */
const STATIONS = 5;

/**
 * What the viewer has already reported from here and is still waiting on —
 * above the problems, so the jam they reported this morning is the first
 * thing they see before reporting it again.
 *
 * Each card is a small tracker: how far along the ticket is and whose move it
 * is, in the overview's words. The page refreshes live, so a card advances, or
 * leaves once IT resolves it, while it is on screen. One the viewer has just
 * sent lands with a glow — including the first, when the strip itself is new;
 * the ones already there when the page loaded do not.
 */
export function OpenReports({
  reports,
  iconByIssue,
  viewerId,
}: {
  reports: OpenReport[];
  /** Each live quick ticket's group icon. A report from one since switched off gets the general one. */
  iconByIssue: Record<string, QuickTicketIcon>;
  viewerId: string;
}) {
  const reduced = useReducedMotion() ?? false;
  // What the page arrived with. Anything else arrived while it was open.
  const [atLoad] = useState(() => new Set(reports.map((report) => report.id)));

  // The viewer's move first — IT waiting on a reply — then the newest.
  const ordered = useMemo(
    () =>
      [...reports].sort(
        (a, b) =>
          Number(b.status === "waiting_on_user") - Number(a.status === "waiting_on_user") ||
          b.created_at.localeCompare(a.created_at),
      ),
    [reports],
  );

  if (ordered.length === 0) return null;

  const shown = ordered.slice(0, SHOWN);
  const more = ordered.length - shown.length;

  return (
    <motion.section
      aria-labelledby="quick-open-reports"
      // Already part of the page if it came with it; otherwise it was just
      // made by a first report, and eases in ahead of the card.
      initial={atLoad.size > 0 || reduced ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: ease.entrance }}
      className="space-y-3"
    >
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-3">
          <h2 id="quick-open-reports" className="eyebrow">
            Your open reports
          </h2>
          <span className="inline-flex items-center gap-1.5 text-[0.6875rem] text-[var(--spec-ok)]">
            <span aria-hidden className="size-1.5 rounded-full bg-current" />
            Updates live
          </span>
        </div>
        <Link
          href="/tickets"
          className="flex-none text-[0.75rem] text-ink-muted underline-offset-4 hover:text-ink hover:underline"
        >
          {more > 0 ? `See all ${ordered.length}` : "My tickets"}
        </Link>
      </div>

      {/* A swipeable strip on a phone, bleeding to the screen edges; a row of
          cards from there up. */}
      <ul
        role="list"
        className={cn(
          "relative -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 no-scrollbar",
          "sm:mx-0 sm:grid sm:snap-none sm:grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] sm:overflow-visible sm:px-0 sm:pb-0",
        )}
      >
        <AnimatePresence mode="popLayout">
          {shown.map((report) => (
            <ReportCard
              key={report.id}
              report={report}
              fresh={!atLoad.has(report.id)}
              icon={iconByIssue[report.quick_ticket_id] ?? "bolt"}
              viewerId={viewerId}
              reduced={reduced}
            />
          ))}
        </AnimatePresence>
      </ul>
    </motion.section>
  );
}

function ReportCard({
  ref,
  report,
  fresh,
  icon,
  viewerId,
  reduced,
}: {
  /** Handed down by AnimatePresence, which measures the card to lift it out as it leaves. */
  ref?: React.Ref<HTMLLIElement>;
  report: OpenReport;
  /** Not on the page when it loaded: just sent, so it arrives rather than being there. */
  fresh: boolean;
  icon: QuickTicketIcon;
  viewerId: string;
  reduced: boolean;
}) {
  const stage = stageOf(report, viewerId);
  const yours = stage.tone === "you";

  return (
    <motion.li
      ref={ref}
      layout={reduced ? false : "position"}
      initial={!fresh ? false : reduced ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.18, ease: ease.exit } }}
      transition={{ ...spring.arrive, layout: spring.gentle }}
      className="w-[min(17rem,82vw)] flex-none snap-start sm:w-auto"
    >
      <Link
        href={`/tickets/${report.id}`}
        className={cn(
          "glyph-host group/report card relative flex h-full flex-col gap-2.5 p-3",
          "transition-[translate,box-shadow,border-color] duration-200 ease-[var(--ease-standard)]",
          "hover:border-line-strong hover:shadow-[var(--shadow-md)] motion-safe:hover:-translate-y-0.5",
        )}
      >
        {fresh && !reduced && (
          // The glow a just-sent report lands with. Decorative.
          <motion.span
            aria-hidden
            initial={{ opacity: 1 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 1.6, ease: ease.standard, delay: 0.5 }}
            className="pointer-events-none absolute -inset-px rounded-[inherit] shadow-[var(--glow)]"
          />
        )}

        <span className="flex items-center gap-2">
          <span
            aria-hidden
            className={cn(
              "flex size-7 flex-none items-center justify-center rounded-[8px] border border-line bg-surface-sunk text-ink-muted",
              "transition-colors duration-300 group-hover/report:border-accent-line group-hover/report:text-accent",
            )}
          >
            <QuickIcon name={icon} className="size-[0.95rem]" />
          </span>
          <span className="readout text-[0.6875rem] font-medium text-ink-muted">{report.ticket_number}</span>
          <TimeAgo value={report.created_at} className="ml-auto truncate text-[0.6875rem] text-ink-faint" />
        </span>

        <span className="line-clamp-2 break-words text-[0.8125rem] font-medium leading-snug text-ink">
          {report.subject}
        </span>

        <span className="mt-auto block space-y-1.5">
          <span aria-hidden className="flex gap-1">
            {Array.from({ length: STATIONS }, (_, i) => (
              <span
                key={i}
                // A step forward lights the stations one after another.
                style={{ transitionDelay: `${i * 70}ms` }}
                className={cn(
                  "h-1 flex-1 rounded-full transition-colors duration-500 ease-[var(--ease-standard)]",
                  i > stage.index ? "bg-line-strong" : yours ? "bg-[var(--tone-dot)]" : "bg-accent",
                )}
                data-tone={yours ? "fuchsia" : undefined}
              />
            ))}
          </span>
          <span
            data-tone={yours ? "fuchsia" : undefined}
            className={cn(
              "flex items-center gap-1.5 text-[0.6875rem]",
              yours ? "font-medium text-[var(--tone-fg)]" : "text-ink-muted",
            )}
          >
            <span className="sr-only">{stage.label}: </span>
            <span className="truncate">{stage.headline}</span>
          </span>
        </span>
      </Link>
    </motion.li>
  );
}

/** Each live quick ticket's group icon, for the strip. */
export function iconsByIssue(groups: { icon: QuickTicketIcon; issues: { id: string }[] }[]) {
  const icons: Record<string, QuickTicketIcon> = {};
  for (const group of groups) for (const issue of group.issues) icons[issue.id] = group.icon;
  return icons;
}
