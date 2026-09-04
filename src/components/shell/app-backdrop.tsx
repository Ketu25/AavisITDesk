/**
 * The surface everything else sits on.
 *
 * Deliberately not a floating animated gradient. This is a plant tool that
 * stays open all shift, so the backdrop has three jobs and no others: give the
 * translucent cards something to sit on, stop the dark ground banding, and
 * carry one piece of ambient information.
 *
 * That last one is `alert`. The far corner warms as breached tickets pile up,
 * so an agent glancing at any screen picks up the state of the desk without
 * reading a number. It tops out low on purpose — peripheral awareness, never
 * an alarm, and never enough to fight body text.
 *
 * Pure CSS. No render loop, no JavaScript, one very slow transform that the
 * global reduced-motion rule already freezes.
 */
export function AppBackdrop({
  alert = 0,
  variant = "app",
}: {
  alert?: number;
  /** "auth" centres the lamp over a single card instead of lighting a shell. */
  variant?: "app" | "auth";
}) {
  // Saturates at four: past that the difference stops being readable anyway.
  const strength = Math.min(alert / 4, 1);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div
        className={`absolute inset-0 backdrop-glow${variant === "auth" ? " backdrop-glow--centred" : ""}`}
      />
      <div className="absolute inset-0 backdrop-grid" />
      {strength > 0 && (
        <div
          className="absolute inset-0 backdrop-alert"
          style={{ "--alert": strength } as React.CSSProperties}
        />
      )}
      <div className="absolute inset-0 backdrop-grain" />
    </div>
  );
}
