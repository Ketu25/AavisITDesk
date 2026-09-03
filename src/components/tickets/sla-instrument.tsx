"use client";

import { motion, useReducedMotion } from "motion/react";
import { useIsClient } from "@/components/motion";
import { useSla } from "./pills";
import { SLA_META } from "@/lib/constants";
import { duration as formatDuration } from "@/lib/format";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { SlaRule, Ticket, TicketPriority } from "@/lib/database.types";

type SlaTicket = Pick<
  Ticket,
  "sla_due_at" | "sla_paused_at" | "created_at" | "resolved_at" | "status" | "priority"
>;

type Props = {
  ticket: SlaTicket;
  rules?: Partial<Record<TicketPriority, SlaRule>>;
  className?: string;
};

/** Maps an SLA state onto a measurement colour. */
const SPEC_COLOR: Record<string, string> = {
  on_track: "var(--spec-ok)",
  met: "var(--spec-ok)",
  at_risk: "var(--spec-warn)",
  breached: "var(--spec-fail)",
  paused: "var(--ink-faint)",
  none: "var(--ink-faint)",
};

// A 270° sweep with the gap at the bottom, like a panel meter.
const SWEEP = 270;
const START = 135;
const R = 46;
const CIRC = 2 * Math.PI * R;
const ARC = CIRC * (SWEEP / 360);

/** Rounded on purpose: an unrounded float serialises differently on the server
 *  and the client, which React reports as a hydration mismatch. */
function pointOnArc(fraction: number, radius = R) {
  const angle = ((START + SWEEP * fraction) * Math.PI) / 180;
  return {
    x: Number((60 + radius * Math.cos(angle)).toFixed(3)),
    y: Number((60 + radius * Math.sin(angle)).toFixed(3)),
  };
}

/**
 * The full instrument, for the ticket detail sidebar.
 *
 * Reads as a panel meter on purpose: this is a plant where everything already
 * has a tolerance and a reading, and the SLA is exactly that — elapsed time
 * measured against a target, with a warning band before the limit. The dial
 * ticks every second so a ticket nearing breach visibly moves.
 */
export function SlaDial({ ticket, rules, className }: Props) {
  const sla = useSla(ticket, rules, 1000);
  const reduced = useReducedMotion();
  const isClient = useIsClient();

  if (sla.state === "none") return null;

  const meta = SLA_META[sla.state];
  const color = SPEC_COLOR[sla.state];
  const progress = Math.min(Math.max(sla.progress, 0), 1);
  const threshold = Math.min(
    Math.max((rules?.[ticket.priority]?.at_risk_threshold_pct ?? 75) / 100, 0),
    1,
  );
  // Zero on the server so the markup matches; the real reading sweeps in.
  const shown = isClient ? progress : 0;
  const marker = pointOnArc(shown);
  const overdue = sla.remainingMs < 0;

  return (
    <div className={cn("relative mx-auto w-full max-w-[10.5rem]", className)}>
      <svg viewBox="0 0 120 120" className="block w-full" role="img"
           aria-label={`SLA ${meta.label}, ${formatDuration(sla.remainingMs)} ${overdue ? "over" : "remaining"}`}>
        {/* In-spec zone, then the warning band before the limit. */}
        <circle
          cx="60" cy="60" r={R} fill="none" strokeWidth="7" strokeLinecap="round"
          stroke="var(--spec-ok)" opacity="0.16"
          strokeDasharray={`${ARC * threshold} ${CIRC}`}
          transform={`rotate(${START} 60 60)`}
        />
        <circle
          cx="60" cy="60" r={R} fill="none" strokeWidth="7" strokeLinecap="butt"
          stroke="var(--spec-warn)" opacity="0.22"
          strokeDasharray={`${ARC * (1 - threshold)} ${CIRC}`}
          strokeDashoffset={-ARC * threshold}
          transform={`rotate(${START} 60 60)`}
        />

        {/* The reading. Client-only: it is derived from the current time. */}
        {isClient && (
          <motion.circle
            cx="60" cy="60" r={R} fill="none" strokeWidth="7" strokeLinecap="round"
            stroke={color}
            transform={`rotate(${START} 60 60)`}
            initial={reduced ? false : { strokeDasharray: `0 ${CIRC}` }}
            animate={{ strokeDasharray: `${ARC * shown} ${CIRC}` }}
            transition={reduced ? { duration: 0 } : spring.gentle}
          />
        )}

        {/* Where the limit sits, engraved on the dial. */}
        <line
          x1={pointOnArc(threshold).x}
          y1={pointOnArc(threshold).y}
          x2={pointOnArc(threshold, R + 7).x}
          y2={pointOnArc(threshold, R + 7).y}
          stroke="var(--ink-faint)" strokeWidth="1.5" strokeLinecap="round"
        />

        {isClient && !reduced && (
          <motion.circle
            r="3.5" fill={color}
            initial={false}
            animate={{ cx: marker.x, cy: marker.y }}
            transition={spring.gentle}
          />
        )}
      </svg>

      {/* Centred against the dial itself rather than nudged with a margin, so
          the readout stays put at any width. */}
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="readout text-xl font-semibold leading-none" style={{ color }}>
          {isClient ? formatDuration(sla.remainingMs) : "—"}
        </span>
        <span className="eyebrow mt-1.5">{overdue ? "over target" : "remaining"}</span>
        <span className="mt-2 text-[0.75rem] font-medium" style={{ color }}>
          {meta.label}
        </span>
      </div>
    </div>
  );
}

/**
 * The same measurement compressed to a hairline, for list rows. At a glance
 * down the queue the warning band shows which tickets are close to the limit
 * without reading a single number.
 */
export function SlaTrack({ ticket, rules, className }: Props) {
  const sla = useSla(ticket, rules);
  const reduced = useReducedMotion();
  const isClient = useIsClient();

  if (sla.state === "none") return null;

  const color = SPEC_COLOR[sla.state];
  const progress = Math.min(Math.max(sla.progress, 0), 1);
  const threshold = (rules?.[ticket.priority]?.at_risk_threshold_pct ?? 75) / 100;

  return (
    <div
      className={cn("relative h-[3px] w-full overflow-hidden rounded-full bg-surface-sunk", className)}
      aria-hidden
    >
      <div
        className="absolute inset-y-0 right-0"
        style={{ width: `${(1 - threshold) * 100}%`, background: "var(--spec-warn)", opacity: 0.2 }}
      />
      {/* Client-only for the same reason: the width encodes elapsed time. */}
      {isClient && (
        <motion.div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ background: color }}
          initial={{ width: 0 }}
          animate={{ width: `${progress * 100}%` }}
          transition={reduced ? { duration: 0 } : spring.gentle}
        />
      )}
    </div>
  );
}
