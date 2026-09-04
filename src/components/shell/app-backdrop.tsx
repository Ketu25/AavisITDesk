/**
 * The surface everything else sits on.
 *
 * Two bloom fields drift against each other at different speeds, so the colour
 * separates and recombines the way a mesh gradient does — dynamic without a
 * render loop, a canvas, or anything that repaints on a frame timer. A page
 * someone leaves open all shift cannot afford those, and a busy backdrop would
 * compete with the SLA instrument, which is the one element here allowed to
 * shout.
 *
 * Grain sits on top. It is mostly there to break up the banding that large,
 * very soft gradients produce on a dark ground, but it also stops the surface
 * reading as flat paint.
 *
 * `alert` is the one piece of information the ground carries: the far corner
 * warms as breached tickets accumulate, so an agent glancing at any screen
 * picks up the state of the desk without reading a number. Capped low —
 * peripheral awareness, never an alarm, and never enough to fight body text.
 */
export function AppBackdrop({ alert = 0 }: { alert?: number }) {
  // Saturates at four: past that the difference stops being readable anyway.
  const strength = Math.min(alert / 4, 1);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 backdrop-mesh" />
      <div className="absolute inset-0 backdrop-mesh-alt" />
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
