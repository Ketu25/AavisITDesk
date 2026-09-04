"use client";

import { motion } from "motion/react";
import { Wordmark } from "./logo";
import { AppBackdrop } from "./app-backdrop";

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
      {/* Same backdrop system as the signed-in app, so the two do not read as
          different products. */}
      <AppBackdrop variant="auth" />

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
