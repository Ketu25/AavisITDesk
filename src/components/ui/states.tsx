"use client";

import { motion, useReducedMotion } from "motion/react";
import { spring, transition } from "@/lib/motion";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  const reduced = useReducedMotion();

  return (
    <div className={cn("flex flex-col items-center px-6 py-14 text-center", className)}>
      {icon && (
        <motion.div
          initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={spring.gentle}
          className="mb-3.5 flex size-11 items-center justify-center rounded-xl border border-line bg-surface text-ink-faint"
        >
          {icon}
        </motion.div>
      )}
      <motion.p
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...transition.base, delay: 0.05 }}
        className="text-sm font-medium text-ink"
      >
        {title}
      </motion.p>
      {description && (
        <motion.p
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...transition.base, delay: 0.1 }}
          className="mt-1.5 max-w-sm text-[0.8125rem] leading-relaxed text-ink-muted text-pretty"
        >
          {description}
        </motion.p>
      )}
      {action && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...transition.base, delay: 0.15 }}
          className="mt-4"
        >
          {action}
        </motion.div>
      )}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn("shimmer rounded-md bg-surface-sunk", className)} />
  );
}

export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-3">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full rounded-xl" />
      ))}
    </div>
  );
}
