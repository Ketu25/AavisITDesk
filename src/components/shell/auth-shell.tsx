"use client";

import { motion } from "motion/react";
import { Wordmark } from "./logo";

/** Shared chrome for every signed-out screen. */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-10">
      <div className="grid-backdrop pointer-events-none absolute inset-0" aria-hidden />
      <motion.div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[-14rem] size-[34rem] -translate-x-1/2 rounded-full blur-[110px]"
        style={{ background: "radial-gradient(circle, var(--accent-soft), transparent 68%)" }}
        animate={{ scale: [1, 1.12, 1], opacity: [0.75, 1, 0.75] }}
        transition={{ duration: 11, repeat: Infinity, ease: "easeInOut" }}
      />

      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full max-w-[26rem]"
      >
        <div className="mb-7 flex justify-center">
          <Wordmark />
        </div>

        <div className="card p-6 sm:p-7">
          <h1 className="text-lg font-semibold tracking-tight text-ink">{title}</h1>
          {subtitle && (
            <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-ink-muted text-pretty">
              {subtitle}
            </p>
          )}
          <div className="mt-5">{children}</div>
        </div>

        {footer && <div className="mt-5 text-center text-[0.8125rem] text-ink-muted">{footer}</div>}
      </motion.div>
    </main>
  );
}
