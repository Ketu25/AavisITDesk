"use client";

import { useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useEscape, useFocusTrap, useScrollLock } from "./use-overlay";
import { cn } from "@/lib/utils";

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Escape and the scroll lock were already here; the focus trap was not, so
  // Tab used to walk straight out of an open dialog and into the page behind
  // it. All three now come from one place, shared with the nav drawer.
  useEscape(open, onClose);
  useScrollLock(open);
  useFocusTrap(panelRef, open);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-6">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/45 backdrop-blur-[3px]"
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            tabIndex={-1}
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            className={cn(
              "relative my-auto w-full rounded-2xl border border-line-strong outline-none",
              "bg-canvas-raised shadow-[var(--shadow-lg)]",
              size === "sm" && "max-w-sm",
              size === "md" && "max-w-lg",
              size === "lg" && "max-w-3xl",
            )}
          >
            <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
              <div className="min-w-0">
                <h2 className="text-[0.9375rem] font-semibold tracking-tight text-ink">{title}</h2>
                {description && (
                  <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink-muted">
                    {description}
                  </p>
                )}
              </div>
              <button
                onClick={onClose}
                aria-label="Close"
                className="tap-safe -mr-1 flex-none rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-surface-hover hover:text-ink"
              >
                <svg viewBox="0 0 16 16" className="size-4" fill="none">
                  <path d="m4 4 8 8m0-8-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <div className="px-5 py-4">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
