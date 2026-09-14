"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { motion } from "motion/react";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * The drawer's open state, lifted out of <Sidebar>.
 *
 * The trigger belongs in the page header — a button floating over the header
 * forced every screen to reserve blank space for it — but the drawer itself
 * belongs to the sidebar. One piece of state, two distant consumers, so it
 * goes through context rather than being threaded down from the layout.
 */

export const MOBILE_NAV_ID = "mobile-nav";

type MobileNavValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  close: () => void;
};

const MobileNavContext = createContext<MobileNavValue | null>(null);

export function MobileNavProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const value = useMemo(() => ({ open, setOpen, close }), [open, close]);

  return <MobileNavContext.Provider value={value}>{children}</MobileNavContext.Provider>;
}

export function useMobileNav() {
  const ctx = useContext(MobileNavContext);
  if (!ctx) throw new Error("useMobileNav must be used inside <MobileNavProvider>");
  return ctx;
}

/**
 * Sits inline at the head of the page title, so the header reads as one bar
 * instead of a title dodging a floating square. 44px square: this control only
 * ever appears on touch widths, where anything smaller is a miss.
 */
export function MobileNavTrigger({ className }: { className?: string }) {
  const { open, setOpen } = useMobileNav();

  return (
    <motion.button
      type="button"
      onClick={() => setOpen(true)}
      aria-label="Open navigation"
      aria-expanded={open}
      aria-controls={MOBILE_NAV_ID}
      whileTap={{ scale: 0.92 }}
      transition={spring.snappy}
      className={cn(
        "-ml-1 flex size-11 flex-none items-center justify-center rounded-[11px]",
        "text-ink-muted transition-colors duration-150",
        "hover:bg-surface-hover hover:text-ink lg:hidden",
        className,
      )}
    >
      <svg viewBox="0 0 20 20" className="size-[1.15rem]" fill="none" aria-hidden>
        <path
          d="M3 6h14M3 10h14M3 14h14"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    </motion.button>
  );
}
