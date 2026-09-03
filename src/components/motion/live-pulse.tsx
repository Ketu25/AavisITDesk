"use client";

import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

/**
 * A slow breathing dot. Used only where something is genuinely live — the
 * realtime connection, a running SLA clock — so it never becomes decoration.
 */
export function LivePulse({
  className,
  label,
}: {
  className?: string;
  label?: string;
}) {
  const reduced = useReducedMotion();

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span className="relative flex size-1.5">
        {!reduced && (
          <motion.span
            aria-hidden
            className="absolute inset-0 rounded-full bg-current"
            animate={{ scale: [1, 2.6, 2.6], opacity: [0.55, 0, 0] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: "easeOut" }}
          />
        )}
        <span className="relative size-1.5 rounded-full bg-current" />
      </span>
      {label && <span>{label}</span>}
    </span>
  );
}
