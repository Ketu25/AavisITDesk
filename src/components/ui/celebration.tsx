"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { spring } from "@/lib/motion";

/**
 * A short burst for the one moment in a ticket's life that is good news for
 * the person who raised it: confirming the fix worked.
 *
 * Purely visual and out of the way — no pointer events, no focus, hidden from
 * assistive tech (the caller announces the outcome in words). With reduced
 * motion it is the check alone, fading in and out, with nothing travelling.
 */

const PARTICLES = 14;
const COLORS = ["var(--spec-ok)", "var(--accent)", "#fbbf24", "#38bdf8", "#f472b6"];

export function Celebration({ show }: { show: boolean }) {
  const reduced = useReducedMotion();

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          aria-hidden
          className="pointer-events-none fixed inset-0 z-[90] flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.3 } }}
        >
          <div className="relative flex size-28 items-center justify-center">
            {!reduced && (
              <motion.span
                className="absolute inset-0 rounded-full border-2"
                style={{ borderColor: "var(--spec-ok)" }}
                initial={{ scale: 0.6, opacity: 0.7 }}
                animate={{ scale: 1.9, opacity: 0 }}
                transition={{ duration: 0.9, ease: "easeOut" }}
              />
            )}

            {!reduced &&
              Array.from({ length: PARTICLES }, (_, i) => {
                const angle = (i / PARTICLES) * Math.PI * 2;
                const distance = 72 + (i % 3) * 16;
                return (
                  <motion.span
                    key={i}
                    className="absolute left-1/2 top-1/2 -ml-1 -mt-1 size-2 rounded-full"
                    style={{ background: COLORS[i % COLORS.length] }}
                    initial={{ x: 0, y: 0, scale: 0.4, opacity: 1 }}
                    animate={{
                      x: Math.cos(angle) * distance,
                      y: Math.sin(angle) * distance,
                      scale: [0.4, 1, 0.6],
                      opacity: [1, 1, 0],
                    }}
                    transition={{ duration: 0.95, ease: [0.16, 1, 0.3, 1], delay: 0.08 }}
                  />
                );
              })}

            <motion.div
              className="relative flex size-20 items-center justify-center rounded-full shadow-[var(--shadow-lg)]"
              style={{ background: "var(--spec-ok)" }}
              initial={reduced ? { opacity: 0 } : { scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={reduced ? { duration: 0.2 } : spring.arrive}
            >
              <svg viewBox="0 0 24 24" className="size-10 text-white" fill="none">
                <motion.path
                  d="m5 12.5 4.5 4.5L19 7.5"
                  stroke="currentColor"
                  strokeWidth="2.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  initial={reduced ? false : { pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 0.45, delay: 0.15, ease: "easeOut" }}
                />
              </svg>
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
