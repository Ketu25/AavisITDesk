"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useInView } from "motion/react";
import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/constants";

/** Counts up once when scrolled into view — motion that means something. */
function useCountUp(target: number, active: boolean) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (!active) return;

    const duration = 620;
    const start = performance.now();
    let frame = 0;

    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(target * eased));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, active]);

  return value;
}

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
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const display = useCountUp(value, inView);

  const body = (
    <div
      ref={ref}
      data-tone={tone}
      className={cn(
        "card group relative overflow-hidden p-4 transition-colors",
        href && "hover:bg-surface-hover",
      )}
    >
      <p className="text-[0.6875rem] font-semibold uppercase tracking-wider text-ink-faint">
        {label}
      </p>
      <p className="tabular mt-1.5 flex items-baseline gap-1 text-2xl font-semibold tracking-tight text-ink">
        <motion.span
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          style={tone ? { color: "var(--tone-fg)" } : undefined}
        >
          {display}
        </motion.span>
        {suffix && <span className="text-sm font-medium text-ink-faint">{suffix}</span>}
      </p>
      {hint && <p className="mt-1 truncate text-[0.75rem] text-ink-faint">{hint}</p>}
      {tone && (
        <span
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-px"
          style={{ background: "var(--tone-dot)", opacity: 0.5 }}
        />
      )}
    </div>
  );

  if (!href) return body;

  return (
    <a href={href} className="block focus-visible:rounded-[14px]">
      {body}
    </a>
  );
}
