"use client";

import { forwardRef } from "react";
import { motion, type HTMLMotionProps } from "motion/react";
import { cn } from "@/lib/utils";
import { Spinner } from "./spinner";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "subtle";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-accent text-[var(--accent-ink)] border-transparent shadow-[var(--shadow-sm)] " +
    "hover:brightness-110 active:brightness-95",
  secondary:
    "bg-surface text-ink border-line-strong hover:bg-surface-hover",
  subtle:
    "bg-accent-soft text-accent border-accent-line hover:bg-accent-soft hover:brightness-105",
  ghost:
    "bg-transparent text-ink-muted border-transparent hover:bg-surface-hover hover:text-ink",
  danger:
    "bg-transparent text-[#e11d48] dark:text-[#fb7185] border-[rgb(244_63_94_/_0.3)] " +
    "hover:bg-[rgb(244_63_94_/_0.1)]",
};

const SIZES: Record<Size, string> = {
  sm: "h-7 px-2.5 text-[0.8125rem] gap-1.5 rounded-lg",
  md: "h-9 px-3.5 text-sm gap-2 rounded-[10px]",
  lg: "h-11 px-5 text-[0.9375rem] gap-2 rounded-xl",
};

export type ButtonProps = Omit<HTMLMotionProps<"button">, "ref" | "children"> & {
  children?: React.ReactNode;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: React.ReactNode;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading, icon, className, children, disabled, ...props },
  ref,
) {
  return (
    <motion.button
      ref={ref}
      whileTap={disabled || loading ? undefined : { scale: 0.975 }}
      transition={{ type: "spring", stiffness: 600, damping: 30 }}
      disabled={disabled || loading}
      className={cn(
        "inline-flex select-none items-center justify-center border font-medium",
        "transition-[background-color,color,border-color,filter,opacity] duration-150",
        "disabled:pointer-events-none disabled:opacity-45",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {loading ? <Spinner className="size-3.5" /> : icon}
      {children}
    </motion.button>
  );
});
