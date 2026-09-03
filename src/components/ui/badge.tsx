import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/constants";

/**
 * `solid` fills with the tone; `quiet` keeps only the dot.
 *
 * Hue is a scarce resource here. The SLA reading is the one thing that decides
 * what gets worked on next, so it keeps full colour. Priority is ordered, so it
 * keeps a coloured dot as a rank cue. Status is merely categorical — colouring
 * it added a rainbow that competed with the measurement without encoding
 * anything, so it is neutral.
 */
export function Badge({
  tone = "slate",
  dot = true,
  emphasis = "solid",
  className,
  children,
}: {
  tone?: Tone;
  dot?: boolean;
  emphasis?: "solid" | "quiet";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      data-tone={tone}
      data-emphasis={emphasis}
      className={cn("badge", className)}
    >
      {dot && <span className="tone-dot" />}
      {children}
    </span>
  );
}
