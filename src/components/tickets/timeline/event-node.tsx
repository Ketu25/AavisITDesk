"use client";

import { motion, useReducedMotion } from "motion/react";
import { RAIL, RailMarker } from "./rail";
import { describeEvent, eventTone } from "./describe-event";
import { absoluteTime, relativeTime } from "@/lib/format";
import { transition } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { EventWithActor } from "./types";

/**
 * The ticket's own record of itself: assignment, status, escalation. Set quiet
 * on purpose — it is context for the conversation, not part of it.
 */
export function EventNode({
  event,
  names,
  className,
}: {
  event: EventWithActor;
  names: Map<string, string>;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const tone = eventTone(event);

  return (
    <motion.li
      initial={reduced ? { opacity: 0 } : { opacity: 0, x: -4 }}
      animate={{ opacity: 1, x: 0 }}
      transition={transition.base}
      className={cn("relative py-1.5", RAIL, className)}
    >
      <RailMarker tone={tone} className="top-[0.85rem]" />
      <div className="flex items-baseline gap-3 text-[0.75rem] leading-relaxed text-ink-faint">
        <span className="min-w-0 flex-1">{describeEvent(event, names)}</span>
        <time
          dateTime={event.created_at}
          title={absoluteTime(event.created_at)}
          className="readout flex-none text-[0.6875rem]"
        >
          {relativeTime(event.created_at)}
        </time>
      </div>
    </motion.li>
  );
}
