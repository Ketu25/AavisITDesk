"use client";

import { useEffect, useRef } from "react";
import { useReducedMotion, useSpring } from "motion/react";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * A number that travels to its new value instead of snapping.
 *
 * The tween is written straight to the DOM node rather than through React
 * state: a counter that re-renders sixty times a second would re-render every
 * sibling with it, and it would also trip the "no setState in an effect" rule
 * for no benefit. The server-rendered value is the real one, so this degrades
 * to plain text without JavaScript.
 */
export function AnimatedNumber({
  value,
  format = (n: number) => n.toLocaleString(),
  className,
}: {
  value: number;
  format?: (n: number) => string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduced = useReducedMotion();
  const motionValue = useSpring(value, spring.gentle);

  useEffect(() => {
    if (reduced) {
      if (ref.current) ref.current.textContent = format(value);
      return;
    }
    motionValue.set(value);
  }, [value, reduced, motionValue, format]);

  useEffect(() => {
    return motionValue.on("change", (latest) => {
      if (ref.current) ref.current.textContent = format(Math.round(latest));
    });
  }, [motionValue, format]);

  return (
    <span ref={ref} className={cn("tabular", className)}>
      {format(value)}
    </span>
  );
}
