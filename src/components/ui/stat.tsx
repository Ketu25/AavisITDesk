"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { AnimatedNumber } from "@/components/motion";
import { transition } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/constants";

export function Stat({
  label,
  value,
  hint,
  tone,
  href,
  suffix,
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: Tone;
  href?: string;
  suffix?: string;
}) {
  const body = (
    <div
      data-tone={tone}
      className={cn(
        // h-full, because the grid has already done its part. StaggerChildren
        // wraps each stat in a motion.div, and those wrappers are the grid
        // items — they stretch to the row height correctly. What did not
        // happen is the card filling the cell it was given, so a row where
        // only some stats carry a hint rendered short cards beside a tall one.
        "card group relative h-full overflow-hidden p-4",
        "transition-[background-color,border-color,box-shadow,transform] duration-200",
        href &&
          "hover:-translate-y-px hover:border-line-strong hover:bg-surface-hover hover:shadow-[var(--shadow-md)]",
      )}
    >
      <p className="eyebrow">{label}</p>

      <p className="readout mt-2 flex items-baseline gap-1.5 text-[1.75rem] font-semibold leading-none text-ink">
        <motion.span
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={transition.entrance}
          style={tone ? { color: "var(--tone-fg)" } : undefined}
        >
          <AnimatedNumber value={value} />
        </motion.span>
        {suffix && <span className="text-sm font-medium text-ink-faint">{suffix}</span>}
      </p>

      {hint && <p className="mt-1.5 truncate text-[0.75rem] text-ink-faint">{hint}</p>}

      {/* A lit edge along the bottom, like a segment on a panel. */}
      {tone && (
        <motion.span
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-px origin-left"
          style={{ background: "var(--tone-dot)" }}
          initial={{ scaleX: 0, opacity: 0 }}
          animate={{ scaleX: 1, opacity: 0.6 }}
          transition={transition.entrance}
        />
      )}
    </div>
  );

  if (!href) return body;

  return (
    <Link
      href={href}
      className={cn(
        // The link is the middle of that chain when a stat is clickable, so it
        // has to pass the height through rather than shrink to its content.
        "block h-full rounded-[var(--radius-card)] focus-visible:outline-none",
        "focus-visible:ring-4 focus-visible:ring-[var(--accent-soft)]",
      )}
    >
      {body}
    </Link>
  );
}
