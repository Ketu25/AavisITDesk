import type { Transition, Variants } from "motion/react";

/**
 * One motion vocabulary for the whole app.
 *
 * Every animation reads its timing from here rather than inventing its own, so
 * the interface moves like one machine instead of thirty independent widgets.
 * The values are deliberately short: this is a tool people work in all day, and
 * motion is here to explain what changed, not to perform.
 */

/** Milliseconds. Anything above `slow` starts to feel like waiting. */
export const duration = {
  instant: 0.12,
  fast: 0.18,
  base: 0.24,
  slow: 0.36,
} as const;

/**
 * Entrances decelerate (arriving), exits accelerate (leaving), and anything
 * the user is directly manipulating uses a spring so it tracks the hand.
 */
export const ease = {
  standard: [0.2, 0, 0, 1],
  entrance: [0.16, 1, 0.3, 1],
  exit: [0.4, 0, 1, 1],
} as const;

export const spring = {
  /** Buttons, toggles, anything under a cursor. */
  snappy: { type: "spring", stiffness: 520, damping: 34, mass: 0.7 },
  /** Panels and layout shifts — settles without overshoot. */
  gentle: { type: "spring", stiffness: 320, damping: 32 },
  /** Reserved for arrival moments: a new ticket landing in the queue. */
  arrive: { type: "spring", stiffness: 420, damping: 26, mass: 0.9 },
} satisfies Record<string, Transition>;

export const transition = {
  fast: { duration: duration.fast, ease: ease.standard },
  base: { duration: duration.base, ease: ease.standard },
  entrance: { duration: duration.slow, ease: ease.entrance },
} satisfies Record<string, Transition>;

// ---------------------------------------------------------------- variants --

/** The default arrival: a short rise with the fade, never a slide from far. */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: transition.entrance },
  exit: { opacity: 0, y: -4, transition: transition.fast },
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: transition.base },
  exit: { opacity: 0, transition: transition.fast },
};

/** For things that appear under the pointer: menus, popovers, toasts. */
export const popIn: Variants = {
  hidden: { opacity: 0, scale: 0.96, y: 4 },
  visible: { opacity: 1, scale: 1, y: 0, transition: spring.snappy },
  exit: { opacity: 0, scale: 0.98, transition: transition.fast },
};

/** Parent variant for a list whose children share the `fadeUp` variants. */
export function staggerContainer(step = 0.028): Variants {
  return {
    hidden: {},
    visible: {
      transition: { staggerChildren: step, delayChildren: 0.02, when: "beforeChildren" },
    },
    exit: { transition: { staggerChildren: step / 2, staggerDirection: -1 } },
  };
}

/**
 * Delay for item `index`, flattened after `cap`. The cap is the important part:
 * without it a 200-row queue would still be arriving eight seconds later.
 */
export function stagger(index: number, step = 0.028, cap = 12) {
  return Math.min(index, cap) * step;
}

// ------------------------------------------------------------- reduced mode --

/**
 * A reduced-motion variant set: state still changes visibly, but nothing
 * travels. Opacity alone communicates the change without vestibular cost.
 */
export const reducedVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: duration.instant } },
  exit: { opacity: 0, transition: { duration: duration.instant } },
};
