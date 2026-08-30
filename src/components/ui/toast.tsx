"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";

type ToastTone = "success" | "error" | "info";
type Toast = { id: number; title: string; description?: string; tone: ToastTone };

const ToastContext = createContext<{
  push: (t: Omit<Toast, "id">) => void;
} | null>(null);

const TONE_STYLE: Record<ToastTone, string> = {
  success: "border-[rgb(16_185_129_/_0.35)] bg-[rgb(16_185_129_/_0.10)]",
  error: "border-[rgb(244_63_94_/_0.35)] bg-[rgb(244_63_94_/_0.10)]",
  info: "border-line-strong bg-surface",
};

const ICON: Record<ToastTone, React.ReactNode> = {
  success: (
    <svg viewBox="0 0 20 20" className="size-4 text-[#10b981]" fill="none" aria-hidden>
      <path d="m5 10.5 3.2 3.2L15 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  error: (
    <svg viewBox="0 0 20 20" className="size-4 text-[#f43f5e]" fill="none" aria-hidden>
      <path d="M10 6v5m0 3h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  ),
  info: (
    <svg viewBox="0 0 20 20" className="size-4 text-ink-muted" fill="none" aria-hidden>
      <path d="M10 9v5m0-8h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  ),
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((toast: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { ...toast, id }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">
        <AnimatePresence initial={false}>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              layout
              initial={{ opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 24, scale: 0.96 }}
              transition={{ type: "spring", stiffness: 420, damping: 32 }}
              className={cn(
                "pointer-events-auto flex gap-2.5 rounded-xl border px-3.5 py-3",
                "shadow-[var(--shadow-lg)] backdrop-blur-xl",
                TONE_STYLE[toast.tone],
              )}
            >
              <span className="mt-0.5 flex-none">{ICON[toast.tone]}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">{toast.title}</p>
                {toast.description && (
                  <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">
                    {toast.description}
                  </p>
                )}
              </div>
              <button
                onClick={() => setToasts((p) => p.filter((t) => t.id !== toast.id))}
                className="flex-none self-start text-ink-faint transition-colors hover:text-ink"
                aria-label="Dismiss"
              >
                <svg viewBox="0 0 16 16" className="size-3.5" fill="none">
                  <path d="m4 4 8 8m0-8-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
