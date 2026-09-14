"use client";

import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import { useIsClient } from "./use-is-client";
import { transition } from "@/lib/motion";

/**
 * One arrival for the whole screen, keyed on the route.
 *
 * Before this, each page announced itself piecemeal — the header faded, then
 * the stats cascaded, then the cards — which read as three separate loads of
 * one screen. Now the page arrives as a unit and the cascades inside it are
 * free to do the job they are actually good at: showing the order of a list.
 *
 * Deliberately NOT wrapped in <AnimatePresence>. Presence has to hold a
 * subtree past the point React would drop it, and these routes suspend: the
 * `loading.tsx` fallback and the real page swap in and out underneath. Holding
 * that subtree orphans the fallback's DOM — two headers on the page, neither
 * of them hydrated, nothing clickable. A bare keyed element has none of that
 * problem, and since the outgoing route has no exit animation to play, nothing
 * is lost by letting React unmount it immediately.
 *
 * The first paint stays still. A server-rendered page is already on screen
 * when React hydrates; fading it in there would be inventing a load that never
 * happened. Only navigations animate.
 */
export function RouteTransition({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const pathname = usePathname();
  const reduced = useReducedMotion();
  // False through the hydration pass, true from the next render on — so the
  // server-rendered first paint is left alone and every navigation after it
  // animates. This component never remounts, so the flag stays true once set.
  const hydrated = useIsClient();

  return (
    <motion.div
      key={pathname}
      initial={hydrated ? (reduced ? { opacity: 0 } : { opacity: 0, y: 6 }) : false}
      animate={{ opacity: 1, y: 0 }}
      transition={reduced ? transition.fast : transition.entrance}
      className={className}
    >
      {children}
    </motion.div>
  );
}
