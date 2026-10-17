/**
 * Arrow keys by where things sit on screen, for the card grid and the quick
 * tickets in a group's pop-up. Both lay out in a column count chosen by the
 * room available, so positions — not list order — are what the keys follow.
 */

export type Dir = "up" | "down" | "left" | "right";

export const ARROWS: Record<string, Dir> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

/**
 * The item an arrow key should land on: the closest one in that direction,
 * with distance off the arrow's line counting double — so Down finds the next
 * one in the same column before one beside it, and Right finds the one level
 * with it.
 */
export function nearest(from: HTMLElement, items: HTMLElement[], dir: Dir) {
  const a = from.getBoundingClientRect();
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;

  for (const el of items) {
    if (el === from) continue;
    const b = el.getBoundingClientRect();
    const dx = b.left + b.width / 2 - ax;
    const dy = b.top + b.height / 2 - ay;
    const along = dir === "down" ? dy : dir === "up" ? -dy : dir === "right" ? dx : -dx;
    const across = dir === "down" || dir === "up" ? Math.abs(dx) : Math.abs(dy);
    if (along <= 1) continue;
    const score = along + across * 2;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}
