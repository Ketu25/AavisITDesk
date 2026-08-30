import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/constants";

export function Badge({
  tone = "slate",
  dot = true,
  className,
  children,
}: {
  tone?: Tone;
  dot?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span data-tone={tone} className={cn("badge", className)}>
      {dot && <span className="tone-dot" />}
      {children}
    </span>
  );
}
