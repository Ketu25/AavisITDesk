"use client";

import { isQuickIcon } from "@/lib/quick-tickets";
import type { QuickTicketIcon } from "@/lib/constants";

/**
 * A group's icon by name. Anything outside the set falls back to the general one.
 *
 * Drawn here, rather than taken from the shell's icon set, so the parts that
 * move can carry a class. Inside anything marked `.glyph-host` the icon acts
 * out its problem once when the host is hovered or focused: the printer feeds
 * a sheet, the envelope opens, the phone rings. Anywhere else it is a still
 * icon. The motion lives in globals.css, behind prefers-reduced-motion, and
 * each part's resting state is the plain icon, so nothing depends on it.
 */
export function QuickIcon({ name, className }: { name: string; className?: string }) {
  const Glyph = GLYPHS[isQuickIcon(name) ? name : "bolt"];
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className={className ?? "size-[1.05rem] flex-none"}
      aria-hidden
    >
      <Glyph />
    </svg>
  );
}

const GLYPHS: Record<QuickTicketIcon, () => React.ReactNode> = {
  printer: () => (
    <>
      <path d="M6 7.4V3.8c0-.5.4-.8.8-.8h6.4c.4 0 .8.3.8.8v3.6" strokeLinejoin="round" />
      <path
        d="M6 14.2H4.4c-.8 0-1.4-.6-1.4-1.4V8.8c0-.8.6-1.4 1.4-1.4h11.2c.8 0 1.4.6 1.4 1.4v4c0 .8-.6 1.4-1.4 1.4H14"
        strokeLinejoin="round"
      />
      <rect className="qg-sheet" x="6" y="11.4" width="8" height="5.6" rx=".8" />
      <path className="qg-led" d="M13.6 9.8h.01" strokeWidth="2" strokeLinecap="round" />
    </>
  ),
  folder: () => (
    <>
      <path
        className="qg-folder"
        d="M2.8 6.1c0-.9.7-1.6 1.6-1.6h3.2l1.7 1.9h6.3c.9 0 1.6.7 1.6 1.6v6.4c0 .9-.7 1.6-1.6 1.6H4.4c-.9 0-1.6-.7-1.6-1.6V6.1Z"
        strokeLinejoin="round"
      />
      <path className="qg-lid" d="M2.8 9h14.4" strokeLinecap="round" />
    </>
  ),
  wifi: () => (
    <>
      <path className="qg-arc qg-arc-1" d="M7.8 13a3.1 3.1 0 0 1 4.4 0" strokeLinecap="round" />
      <path className="qg-arc qg-arc-2" d="M5.2 10.3a6.7 6.7 0 0 1 9.6 0" strokeLinecap="round" />
      <path className="qg-arc qg-arc-3" d="M2.6 7.6a10.4 10.4 0 0 1 14.8 0" strokeLinecap="round" />
      <path d="M10 15.9h.01" strokeWidth="2.2" strokeLinecap="round" />
    </>
  ),
  mail: () => (
    <>
      <rect className="qg-envelope" x="2.8" y="4.4" width="14.4" height="11.2" rx="1.8" />
      <path className="qg-flap" d="m3.6 5.6 6.4 5 6.4-5" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  monitor: () => (
    <>
      <rect x="2.6" y="3.4" width="14.8" height="10.2" rx="1.6" />
      {/* The screen coming on. Invisible at rest, so the still icon is unchanged. */}
      <rect
        className="qg-screen"
        x="4.4"
        y="5.2"
        width="11.2"
        height="6.6"
        rx=".6"
        fill="currentColor"
        stroke="none"
        opacity="0"
      />
      <path d="M7.2 16.6h5.6M10 13.6v3" strokeLinecap="round" />
    </>
  ),
  phone: () => (
    <>
      <path
        className="qg-handset"
        d="M5.3 3.2h2.1l1.2 3.1-1.5 1c.8 1.8 2 3 3.7 3.7l1-1.5 3.1 1.2v2.1c0 .9-.7 1.6-1.6 1.6A11.3 11.3 0 0 1 3.7 4.8c0-.9.7-1.6 1.6-1.6Z"
        strokeLinejoin="round"
      />
      <path
        className="qg-waves"
        d="M11.8 2.6a6 6 0 0 1 5.6 5.6M11.6 5.4a3 3 0 0 1 2.8 2.8"
        strokeLinecap="round"
        opacity="0"
      />
    </>
  ),
  key: () => (
    <g className="qg-key">
      <circle cx="7" cy="12.8" r="3.4" />
      <path d="m9.4 10.4 7-7M14 5.8l1.9 1.9M12.2 7.6l1.4 1.4" strokeLinecap="round" />
    </g>
  ),
  shield: () => (
    <>
      <path
        className="qg-shield"
        d="M10 2.8 4.2 5v4.5c0 3.6 2.4 6.3 5.8 7.7 3.4-1.4 5.8-4.1 5.8-7.7V5L10 2.8Z"
        strokeLinejoin="round"
      />
      <path
        className="qg-check"
        d="m7.6 10 1.7 1.7 3.2-3.4"
        pathLength={1}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),
  app: () => (
    <>
      <rect x="2.8" y="3.6" width="14.4" height="12.8" rx="1.8" />
      <path d="M2.8 7.2h14.4" />
      <path className="qg-dot qg-dot-1" d="M5.4 5.4h.01" strokeWidth="1.8" strokeLinecap="round" />
      <path className="qg-dot qg-dot-2" d="M7.4 5.4h.01" strokeWidth="1.8" strokeLinecap="round" />
      {/* Content loading in. Invisible at rest. */}
      <path className="qg-bar qg-bar-1" d="M5.6 10.4h5.6" strokeLinecap="round" opacity="0" />
      <path className="qg-bar qg-bar-2" d="M5.6 13.2h8.8" strokeLinecap="round" opacity="0" />
    </>
  ),
  wrench: () => (
    <path
      className="qg-wrench"
      d="M12.7 3.1a3.9 3.9 0 0 0-4 5.2l-5.3 5.3a1.6 1.6 0 0 0 2.3 2.3l5.3-5.3a3.9 3.9 0 0 0 5.2-4l-2.3 2.3-2-.5-.5-2 2.3-2.3h-1Z"
      strokeLinejoin="round"
    />
  ),
  bolt: () => (
    <path
      className="qg-bolt"
      d="M11.2 2.8 4.6 11.2h4.8l-.6 6 6.6-8.4h-4.8l.6-6Z"
      fill="currentColor"
      fillOpacity="0"
      strokeLinejoin="round"
    />
  ),
};
