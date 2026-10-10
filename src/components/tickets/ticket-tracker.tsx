"use client";

import { useMemo } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { SlaPill } from "./pills";
import { SlaDial } from "./sla-instrument";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { TimeAgo } from "@/components/ui/time-ago";
import { Icons } from "@/components/shell/icons";
import { indexRules } from "@/lib/sla";
import { spring, stagger, transition } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { SlaRule, TicketPriority } from "@/lib/database.types";
import type { TicketRowData } from "./ticket-row";

/**
 * Where a ticket is in its life, drawn as five stations.
 *
 * The queue and the list rows already say *what* a ticket's status is. What a
 * requester actually wants to know is how far along it is and whose move it
 * is — so this reads like a parcel tracker, and the line between stations
 * fills as IT works. The page refreshes live, so a station lighting up is
 * something the requester can watch happen.
 */

const STEPS = ["Raised", "Assigned", "In progress", "Resolved", "Closed"] as const;

/** Whose move it is, which decides the colour of the current station. */
type Tone = "desk" | "you" | "done";

type Stage = {
  /** 0–4, into STEPS. */
  index: number;
  /** The current station's label; it can say more than the generic step. */
  label: string;
  tone: Tone;
  /** One line on what is happening, in the requester's terms. */
  headline: string;
};

const TONE_COLOR: Record<Tone, string> = {
  desk: "var(--accent)",
  you: "var(--tone-dot)",
  done: "var(--spec-ok)",
};

/** `data-tone` for each, so `--tone-*` resolve to the right hue in both themes. */
const TONE_ATTR: Record<Tone, string | undefined> = {
  desk: undefined,
  you: "fuchsia",
  done: "emerald",
};

export function stageOf(ticket: Pick<TicketRowData, "status" | "assignee">): Stage {
  const who = ticket.assignee?.full_name ?? null;

  switch (ticket.status) {
    case "new":
      return { index: 0, label: "Raised", tone: "desk", headline: "Waiting for IT to pick it up" };
    case "assigned":
      return {
        index: 1,
        label: "Assigned",
        tone: "desk",
        headline: who ? `${who} has picked it up` : "Assigned — work starts soon",
      };
    case "in_progress":
      return {
        index: 2,
        label: "In progress",
        tone: "desk",
        headline: who ? `${who} is working on it` : "IT is working on it",
      };
    case "waiting_on_user":
      return {
        index: 2,
        label: "Waiting on you",
        tone: "you",
        headline: `${who ?? "IT"} needs your reply`,
      };
    case "reopened":
      // Reopening keeps the assignee, so the ticket is back with that person
      // rather than back at the start.
      return who
        ? { index: 1, label: "Reopened", tone: "desk", headline: `Reopened — back with ${who}` }
        : { index: 0, label: "Reopened", tone: "desk", headline: "Reopened — waiting for IT to pick it up" };
    case "resolved":
      return {
        index: 3,
        label: "Resolved",
        tone: "done",
        headline: `${who ?? "IT"} marked it fixed — does it work?`,
      };
    case "closed":
      return { index: 4, label: "Closed", tone: "done", headline: "Closed" };
  }
}

function Steps({ stage }: { stage: Stage }) {
  const reduced = useReducedMotion();
  const color = TONE_COLOR[stage.tone];
  const last = STEPS.length - 1;

  return (
    <div aria-hidden className="relative grid grid-cols-5 pt-0.5">
      {/* The rail runs from the centre of the first column to the centre of
          the last, so it starts and ends exactly under the end stations. */}
      <span className="absolute left-[10%] right-[10%] top-[9px] h-[2px] rounded-full bg-line-strong" />
      <motion.span
        className="absolute left-[10%] top-[9px] h-[2px] w-[80%] origin-left rounded-full"
        style={{ background: color }}
        initial={reduced ? false : { scaleX: 0 }}
        animate={{ scaleX: stage.index / last }}
        transition={reduced ? { duration: 0 } : spring.gentle}
      />

      {STEPS.map((step, i) => {
        const done = i < stage.index || (i === stage.index && stage.index === last);
        const current = i === stage.index && !done;
        const label = i === stage.index ? stage.label : step;

        return (
          <div key={step} className="relative flex flex-col items-center">
            <span className="relative flex size-[18px] items-center justify-center">
              {current && !reduced && (
                <motion.span
                  className="absolute inset-0 rounded-full"
                  style={{ background: color }}
                  animate={{ scale: [1, 2.1], opacity: [0.4, 0] }}
                  transition={{ duration: 2.2, repeat: Infinity, ease: "easeOut" }}
                />
              )}
              <motion.span
                className={cn(
                  "relative flex size-[18px] items-center justify-center rounded-full border-2",
                  !done && !current && "border-line-strong bg-canvas-raised",
                )}
                style={
                  done
                    ? { background: color, borderColor: color, color: "var(--canvas-raised)" }
                    : current
                      ? { borderColor: color, background: "var(--canvas-raised)" }
                      : undefined
                }
                initial={false}
                animate={{ scale: current ? 1.08 : 1 }}
                transition={reduced ? { duration: 0 } : spring.snappy}
              >
                {done ? (
                  <Icons.check className="size-2.5" />
                ) : current ? (
                  <span className="size-1.5 rounded-full" style={{ background: color }} />
                ) : null}
              </motion.span>
            </span>
            <span
              className={cn(
                "mt-1.5 whitespace-nowrap text-[0.6875rem] leading-none",
                // On a phone only the current station is named; five labels do
                // not fit in five columns that narrow.
                i === stage.index ? "font-medium" : "hidden text-ink-faint sm:block",
                done && i !== stage.index && "text-ink-muted",
              )}
              style={i === stage.index ? { color } : undefined}
            >
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function TrackerCard({
  ticket,
  rules,
  index,
}: {
  ticket: TicketRowData;
  rules: Partial<Record<TicketPriority, SlaRule>>;
  index: number;
}) {
  const reduced = useReducedMotion();
  const stage = stageOf(ticket);
  const needsYou = stage.tone === "you" || ticket.status === "resolved";

  return (
    <motion.li
      layout="position"
      className="min-w-0"
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98, transition: { ...transition.fast, delay: 0 } }}
      transition={{
        ...(reduced ? transition.fast : spring.arrive),
        delay: reduced ? 0 : stagger(index),
        layout: reduced ? { duration: 0 } : { ...spring.gentle, delay: 0 },
      }}
    >
      <Link
        href={`/tickets/${ticket.id}`}
        data-tone={TONE_ATTR[stage.tone]}
        className={cn(
          "card group flex h-full gap-4 p-4 outline-none",
          "transition-[background-color,border-color,box-shadow,transform] duration-200",
          "hover:-translate-y-px hover:border-line-strong hover:bg-surface-hover hover:shadow-[var(--shadow-md)]",
          "focus-visible:ring-4 focus-visible:ring-[var(--accent-soft)]",
          needsYou && "border-[var(--tone-bd)] hover:border-[var(--tone-bd)]",
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="readout flex-none whitespace-nowrap text-[0.6875rem] text-ink-muted">
              {ticket.ticket_number}
            </span>
            <span className="text-[0.6875rem] text-ink-faint">·</span>
            <span className="truncate text-[0.6875rem] text-ink-faint">{ticket.category}</span>
            {ticket.reopen_count > 0 && (
              <span className="tabular flex-none rounded bg-surface-sunk px-1.5 text-[0.625rem] font-medium text-ink-muted">
                reopened ×{ticket.reopen_count}
              </span>
            )}
            {/* The dial does not fit beside the rail on a phone; the pill
                carries the same reading there. */}
            <span className="ml-auto flex-none sm:hidden">
              {ticket.status === "resolved" ? (
                <Badge tone="emerald">Confirm the fix</Badge>
              ) : (
                <SlaPill ticket={ticket} rules={rules} />
              )}
            </span>
          </div>

          <p className="mt-0.5 truncate text-[0.9375rem] font-medium text-ink">{ticket.subject}</p>

          <div className="mt-4">
            <Steps stage={stage} />
          </div>
          <p className="sr-only">
            Step {stage.index + 1} of {STEPS.length}: {stage.label}.
          </p>

          {/* On a phone "updated …" drops to its own line, so the line that says
              whose move it is keeps the width. */}
          <div className="mt-4 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[0.75rem] sm:flex-nowrap">
            <span className="flex min-w-0 flex-1 items-center gap-2 sm:flex-initial">
              {ticket.assignee ? (
                <Avatar name={ticket.assignee.full_name} id={ticket.assignee.id} size="xs" />
              ) : (
                <span
                  aria-hidden
                  className="flex size-5 flex-none items-center justify-center rounded-full border border-dashed border-line-strong text-[0.5625rem] text-ink-faint"
                >
                  ?
                </span>
              )}
              <span
                className={cn("min-w-0 truncate", needsYou ? "font-medium" : "text-ink-muted")}
                style={needsYou ? { color: "var(--tone-fg)" } : undefined}
              >
                {stage.headline}
              </span>
            </span>
            <span className="hidden flex-none text-ink-faint sm:inline">·</span>
            <span className="w-full flex-none pl-7 text-ink-faint sm:w-auto sm:pl-0">
              updated <TimeAgo value={ticket.updated_at} />
            </span>
          </div>
        </div>

        <div className="hidden w-[6.75rem] flex-none items-center justify-center sm:flex">
          {ticket.status === "resolved" ? (
            <span className="flex flex-col items-center gap-2 text-center">
              <span
                className="flex size-10 items-center justify-center rounded-full"
                style={{ background: "var(--tone-bg)", color: "var(--tone-fg)" }}
              >
                <Icons.check className="size-5" />
              </span>
              <span className="text-[0.75rem] font-medium leading-tight" style={{ color: "var(--tone-fg)" }}>
                Confirm
                <br />
                the fix
              </span>
            </span>
          ) : (
            <SlaDial ticket={ticket} rules={rules} size="sm" />
          )}
        </div>
      </Link>
    </motion.li>
  );
}

/**
 * The requester's unfinished tickets, the ones waiting on them first. `total`
 * is every unfinished ticket, so the overflow line can say how many more there
 * are than the handful shown.
 */
export function ActiveTickets({
  tickets,
  rules,
  total,
}: {
  tickets: TicketRowData[];
  rules: SlaRule[];
  total: number;
}) {
  const ruleIndex = useMemo(() => indexRules(rules), [rules]);
  const more = Math.max(total - tickets.length, 0);

  return (
    <div className="space-y-2.5">
      {/* Explicit `minmax(0, 1fr)` columns: an implicit grid column sizes to
          its content, and a long subject would push the card past the screen
          instead of truncating. */}
      <ul className={cn("grid grid-cols-1 gap-3", tickets.length > 1 && "xl:grid-cols-2")}>
        <AnimatePresence initial={false} mode="popLayout">
          {tickets.map((ticket, index) => (
            <TrackerCard key={ticket.id} ticket={ticket} rules={ruleIndex} index={index} />
          ))}
        </AnimatePresence>
      </ul>
      {more > 0 && (
        <Link
          href="/tickets"
          className="inline-flex items-center gap-1 text-[0.75rem] text-ink-muted underline-offset-4 hover:text-ink hover:underline"
        >
          {more} more {more === 1 ? "ticket" : "tickets"} in progress — see them in My tickets
        </Link>
      )}
    </div>
  );
}
