import { cn } from "@/lib/utils";

/**
 * The Aavis mark: a monitor on a stand, the "A" peak sitting inside it as
 * screen content, and a status LED on the bezel.
 *
 * Static at rest. Hovering the wordmark runs a light pen along the outline and
 * draws it, then flicks the LED on as the trace finishes. All of that lives in
 * globals.css under `.aavis-mark` / `.aavis-trigger`, which is why this stays a
 * server component — there is no state to hold and nothing to hydrate.
 *
 * Colours resolve through --logo-* rather than being baked in here, so the mark
 * re-grades with the theme along with everything else.
 */

/** The screen, its stand and the bezel, drawn as one stroke. */
const FRAME_PATH =
  "M8.3 20.6 L15.7 20.6 L12 20.6 L12 16.6 L18.9 16.6 Q21.3 16.6 21.3 14.2 L21.3 6.1 Q21.3 3.7 18.9 3.7 L5.1 3.7 Q2.7 3.7 2.7 6.1 L2.7 14.2 Q2.7 16.6 5.1 16.6 L12 16.6";
/** The "A" apex, as content on the screen. */
const PEAK_PATH = "M8.1 12.7L12 7.3l3.9 5.4";

export function Logo({ className, size = 28 }: { className?: string; size?: number }) {
  return (
    <span
      className={cn("aavis-mark", className)}
      style={{ "--aavis-mark-size": `${size}px` } as React.CSSProperties}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" fill="none">
        <path
          className="aavis-mark__frame"
          d={FRAME_PATH}
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.94"
        />
        <path
          className="aavis-mark__peak"
          d={PEAK_PATH}
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle className="aavis-mark__led" cx="18.3" cy="13.9" r="1.2" />
        {/* Wrapper carries the on/off timing, the polygon rides the path. */}
        <g className="aavis-mark__arrow">
          <polygon className="aavis-mark__pen" points="0,-2.6 6.2,0 0,2.6 1.5,0" />
        </g>
      </svg>
    </span>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("aavis-trigger flex items-center gap-2", className)}>
      <Logo size={26} />
      <span className="text-[0.9375rem] font-semibold tracking-tight text-ink">
        Aavis <span className="text-ink-muted">IT&nbsp;Desk</span>
      </span>
    </span>
  );
}
