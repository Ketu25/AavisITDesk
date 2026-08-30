"use client";

import { forwardRef, useId } from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";

const CONTROL =
  "w-full rounded-[10px] border border-line bg-surface-sunk px-3 text-sm text-ink " +
  "transition-colors duration-150 placeholder:text-ink-faint " +
  "hover:border-line-strong focus:border-accent-line focus:outline-none " +
  "focus:ring-4 focus:ring-[var(--accent-soft)] disabled:opacity-50";

export function Field({
  label,
  hint,
  error,
  required,
  htmlFor,
  children,
  className,
}: {
  label?: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {label && (
        <label
          htmlFor={htmlFor}
          className="flex items-baseline gap-1 text-[0.8125rem] font-medium text-ink-muted"
        >
          {label}
          {required && <span className="text-[#f43f5e]">*</span>}
        </label>
      )}
      {children}
      <AnimatePresence mode="wait" initial={false}>
        {error ? (
          <motion.p
            key="error"
            initial={{ opacity: 0, y: -3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -3 }}
            transition={{ duration: 0.15 }}
            className="text-xs text-[#e11d48] dark:text-[#fb7185]"
          >
            {error}
          </motion.p>
        ) : hint ? (
          <p key="hint" className="text-xs text-ink-faint">
            {hint}
          </p>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(CONTROL, "h-9", className)} {...props} />;
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn(CONTROL, "min-h-24 resize-y py-2 leading-relaxed", className)}
        {...props}
      />
    );
  },
);

export const Select = forwardRef<HTMLSelectElement, React.ComponentProps<"select">>(
  function Select({ className, children, ...props }, ref) {
    return (
      <div className="relative">
        <select
          ref={ref}
          className={cn(CONTROL, "h-9 cursor-pointer appearance-none pr-8", className)}
          {...props}
        >
          {children}
        </select>
        <svg
          className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-faint"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden
        >
          <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </div>
    );
  },
);

export function Switch({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-medium text-ink">
          {label}
        </label>
        {hint && <p className="mt-0.5 text-xs text-ink-faint">{hint}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-[22px] w-[38px] flex-none rounded-full border transition-colors duration-200",
          checked ? "border-transparent bg-accent" : "border-line bg-surface-sunk",
          disabled && "opacity-50",
        )}
      >
        <motion.span
          layout
          transition={{ type: "spring", stiffness: 700, damping: 34 }}
          className={cn(
            "absolute top-[2px] size-4 rounded-full bg-white shadow-sm",
            checked ? "left-[18px]" : "left-[2px]",
          )}
        />
      </button>
    </div>
  );
}
