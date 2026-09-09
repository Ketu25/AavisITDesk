"use client";

import { Children, isValidElement } from "react";
import { motion, useReducedMotion, type HTMLMotionProps } from "motion/react";
import { fadeUp, reducedVariants, staggerContainer } from "@/lib/motion";

/**
 * Container for a cascade. Children marked <StaggerItem> arrive in sequence
 * rather than all at once, which lets the eye land on the first thing instead
 * of the whole screen appearing as one block.
 */
export function Stagger({
  step = 0.045,
  children,
  ...props
}: Omit<HTMLMotionProps<"div">, "variants" | "initial" | "animate"> & {
  /** Seconds between children. Keep it small; this is texture, not a show. */
  step?: number;
}) {
  const reduced = useReducedMotion();

  return (
    <motion.div
      variants={reduced ? undefined : staggerContainer(step)}
      initial="hidden"
      animate="visible"
      {...props}
    >
      {children}
    </motion.div>
  );
}

/** A single step in the cascade. Inherits timing from its <Stagger> parent. */
export function StaggerItem({
  children,
  ...props
}: Omit<HTMLMotionProps<"div">, "variants">) {
  const reduced = useReducedMotion();

  return (
    <motion.div variants={reduced ? reducedVariants : fadeUp} {...props}>
      {children}
    </motion.div>
  );
}

/**
 * Cascades whatever it is given, without each child having to opt in.
 *
 * Useful for the screens that are simply a stack of cards: wrapping the
 * existing container is a one-line change instead of touching every child.
 * Each child gains a wrapper element, which is harmless for the `space-y` and
 * `grid` containers this is used on — spacing and grid placement both apply to
 * direct children either way.
 */
export function StaggerChildren({
  step = 0.05,
  children,
  ...props
}: Omit<HTMLMotionProps<"div">, "variants" | "initial" | "animate" | "children"> & {
  step?: number;
  children?: React.ReactNode;
}) {
  const reduced = useReducedMotion();

  return (
    <motion.div
      variants={reduced ? undefined : staggerContainer(step)}
      initial="hidden"
      animate="visible"
      {...props}
    >
      {Children.map(children, (child, index) =>
        // Falsy children are conditionals the caller left out; passing them
        // through untouched keeps `{cond && <x/>}` working as written.
        isValidElement(child) ? (
          <motion.div key={index} variants={reduced ? reducedVariants : fadeUp}>
            {child}
          </motion.div>
        ) : (
          child
        ),
      )}
    </motion.div>
  );
}
