/**
 * What the server draws where the reply box goes, until the real one has
 * loaded in the browser a moment later. Same box, same height, nothing to
 * click: the composer is almost entirely paste, drop and upload handling, and
 * rendering it on the server put all of that into the Worker for no gain.
 */
export function ComposerPlaceholder() {
  return (
    <div className="card space-y-3 p-4" aria-busy="true" aria-label="Loading the reply box">
      <div className="min-h-24 rounded-[10px] border border-line bg-surface-sunk px-3 py-2 text-sm text-ink-faint">
        Add a reply…
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="size-8 rounded-lg border border-line" />
        <span className="h-7 w-16 rounded-lg bg-accent opacity-45" />
      </div>
    </div>
  );
}
