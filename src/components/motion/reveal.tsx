"use client";

import { motion, useReducedMotion, type HTMLMotionProps } from "motion/react";
import { fadeUp, reducedVariants, stagger } from "@/lib/motion";

type RevealProps = Omit<
  HTMLMotionProps<"div">,
  "variants" | "initial" | "animate" | "whileInView"
> & {
  /** Position in a list; adds a small, capped delay so groups cascade. */
  index?: number;
  /** Wait until scrolled into view instead of animating on mount. */
  whenVisible?: boolean;
};

/**
 * The standard way anything enters. Honours prefers-reduced-motion by falling
 * back to a plain fade, so the change is still visible without travel.
 */
export function Reveal({ index = 0, whenVisible = false, children, ...props }: RevealProps) {
  const reduced = useReducedMotion();
  const variants = reduced ? reducedVariants : fadeUp;

  const activate = whenVisible
    ? { whileInView: "visible", viewport: { once: true, margin: "-48px" } }
    : { animate: "visible" };

  return (
    <motion.div
      variants={variants}
      initial="hidden"
      exit="exit"
      transition={{ delay: reduced ? 0 : stagger(index) }}
      {...activate}
      {...props}
    >
      {children}
    </motion.div>
  );
}
