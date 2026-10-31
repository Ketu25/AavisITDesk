"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { AVERY_5160, slotOrigin } from "@/lib/qr-labels";

/**
 * One sheet of QR labels, drawn at its real size in real units — inches and
 * points, never pixels or rem — so what prints lands on the labels. The
 * preview on screen is the same sheet, scaled down.
 *
 * Every mark is ink, not background: the codes are SVG paths and the test
 * outlines are outlines, so nothing goes missing when a browser prints with
 * background graphics off. Everything is black: grey comes out of a laser
 * printer as a dither of dots, and small type in dots is hard to read.
 */

/** A QR code's dark modules as one SVG path, and how many modules across it is. */
export type QrCode = { path: string; size: number; version: number };

/** One label as printed. */
export type PrintLabel = {
  /** The address its code holds — shared by every copy of the same label. */
  url: string;
  name: string;
  location: string;
  code: QrCode;
};

/** The point sizes that fit a label's name and location into the lines they are allowed. */
export type LabelFit = { name: number; location: number };

/** A label's text, which is all that decides its fit. */
export type LabelText = { name: string; location: string };

export const textKey = ({ name, location }: LabelText) => `${name}\u0000${location}`;

/** What a label is drawn with until its text has been measured. Printing waits for the measuring. */
export const FALLBACK_FIT: LabelFit = { name: 11, location: 7 };

// Inside a label, in inches from its top-left corner. The code sits square
// on the left with at least 0.12" of white all round — over four modules of
// quiet zone at any version a label allows, with room for a printer that
// lands a millimetre off.
const CODE = { left: 0.12, top: 0.12, size: 0.76 };
const TEXT = { left: 0.99, right: 0.11, top: 0.1, bottom: 0.1 };
const TEXT_WIDTH = AVERY_5160.labelWidth - TEXT.left - TEXT.right;
/** The text column's height, in points. */
const TEXT_HEIGHT = (AVERY_5160.labelHeight - TEXT.top - TEXT.bottom) * 72;

// Type, in points. The name gets the room; the location shrinks first. A
// name takes a third line only when two won't hold it at any size — a group
// can be called sixty characters' worth.
const EYEBROW = { size: 5.5, lineHeight: 1.2, gap: 2.5 };
const NAME = { sizes: [16, 15, 14, 13, 12, 11, 10.5, 10, 9.5, 9, 8.5, 8], lineHeight: 1.12, maxLines: 3 };
const WHERE = { sizes: [8, 7.5, 7, 6.5, 6], lineHeight: 1.2, gap: 3, maxLines: 2 };
const PX_PER_PT = 96 / 72;

const inch = (value: number) => `${value}in`;

/**
 * The sheet's styles, and the print rules that go with it. Mounted only while
 * the label printer is on screen, so no other page loses its print margins.
 *
 * Printing hides everything in the page except `.qrl-print` — a direct child
 * of <body> — and sets the paper to Letter with no margins of its own, so the
 * sheet's inches are the paper's inches. `@page` is honoured by Chrome,
 * Edge, Firefox and Safari 18.2 on; scale still has to be 100%, which only
 * the print dialog can set.
 */
export const SHEET_CSS = `
@page { size: ${AVERY_5160.pageWidth}in ${AVERY_5160.pageHeight}in; margin: 0; }
.qrl-sheet {
  position: relative;
  box-sizing: border-box;
  width: ${inch(AVERY_5160.pageWidth)};
  height: ${inch(AVERY_5160.pageHeight)};
  overflow: hidden;
  background: #fff;
  color: #000;
  font-family: var(--font-sans);
  text-align: left;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.qrl-paper, .qrl-ink { position: absolute; inset: 0; }
.qrl-slot, .qrl-die {
  position: absolute;
  box-sizing: border-box;
  width: ${inch(AVERY_5160.labelWidth)};
  height: ${inch(AVERY_5160.labelHeight)};
  border-radius: ${inch(AVERY_5160.cornerRadius)};
}
.qrl-sheet[data-outline] .qrl-slot { outline: 0.5pt dashed #000; outline-offset: -0.5pt; }
.qrl-die { box-shadow: inset 0 0 0 1px #dfe3ea; }
.qrl-code {
  position: absolute;
  left: ${inch(CODE.left)};
  top: ${inch(CODE.top)};
  width: ${inch(CODE.size)};
  height: ${inch(CODE.size)};
  display: block;
}
.qrl-text {
  position: absolute;
  left: ${inch(TEXT.left)};
  right: ${inch(TEXT.right)};
  top: ${inch(TEXT.top)};
  bottom: ${inch(TEXT.bottom)};
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.qrl-text p { margin: 0; }
.qrl-text .qrl-eyebrow {
  margin-bottom: ${EYEBROW.gap}pt;
  font-family: var(--font-mono);
  font-size: ${EYEBROW.size}pt;
  font-weight: 500;
  line-height: ${EYEBROW.lineHeight};
  letter-spacing: 0.08em;
  text-transform: uppercase;
  white-space: nowrap;
  overflow: hidden;
}
.qrl-name, .qrl-where {
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.qrl-name {
  font-weight: 600;
  line-height: ${NAME.lineHeight};
  letter-spacing: -0.01em;
  -webkit-line-clamp: ${NAME.maxLines};
  line-clamp: ${NAME.maxLines};
}
.qrl-where {
  font-weight: 400;
  line-height: ${WHERE.lineHeight};
  -webkit-line-clamp: ${WHERE.maxLines};
  line-clamp: ${WHERE.maxLines};
}
.qrl-text .qrl-where { margin-top: ${WHERE.gap}pt; }
.qrl-measure {
  position: fixed;
  left: -10000px;
  top: 0;
  width: ${inch(TEXT_WIDTH)};
  visibility: hidden;
  pointer-events: none;
}
.qrl-measure .qrl-name, .qrl-measure .qrl-where {
  display: block;
  -webkit-line-clamp: none;
  line-clamp: none;
  overflow: visible;
}
.qrl-print { display: none; }
@media print {
  html, body {
    margin: 0 !important;
    padding: 0 !important;
    height: auto !important;
    min-height: 0 !important;
    overflow: visible !important;
    background: #fff !important;
  }
  body > :not(.qrl-print) { display: none !important; }
  .qrl-print { display: block !important; }
  .qrl-print .qrl-sheet { break-after: page; break-inside: avoid; }
  .qrl-print .qrl-sheet:last-child { break-after: auto; }
  .qrl-print-empty { padding: 1in; font: 12pt/1.5 var(--font-sans); color: #000; }
}
`;

/**
 * The largest name, then location, that fit their lines and the label's
 * height together — measured in the label's own font, in an element laid out
 * exactly like the label's text column.
 */
function measureFit(root: HTMLElement, { name, location }: LabelText): LabelFit {
  let nameEl = root.querySelector<HTMLElement>(".qrl-name");
  let whereEl = root.querySelector<HTMLElement>(".qrl-where");
  if (!nameEl || !whereEl) {
    nameEl = document.createElement("p");
    nameEl.className = "qrl-name";
    whereEl = document.createElement("p");
    whereEl.className = "qrl-where";
    root.replaceChildren(nameEl, whereEl);
  }
  nameEl.textContent = name;
  whereEl.textContent = location;

  const lines = (el: HTMLElement, size: number, lineHeight: number) => {
    el.style.fontSize = `${size}pt`;
    return Math.round(el.getBoundingClientRect().height / (size * PX_PER_PT * lineHeight));
  };

  const room = TEXT_HEIGHT - EYEBROW.size * EYEBROW.lineHeight - EYEBROW.gap - 0.5;
  const whereHeights = location
    ? WHERE.sizes.map((size) => {
        const count = lines(whereEl, size, WHERE.lineHeight);
        return { size, fits: count <= WHERE.maxLines, height: WHERE.gap + count * size * WHERE.lineHeight };
      })
    : [];
  const nameLines = new Map(NAME.sizes.map((size) => [size, lines(nameEl, size, NAME.lineHeight)]));

  // Two lines for the name if any size allows it; a third only if none does.
  for (const most of [2, NAME.maxLines]) {
    for (const size of NAME.sizes) {
      const count = nameLines.get(size) ?? Infinity;
      if (count > most) continue;
      const nameHeight = count * size * NAME.lineHeight;
      if (!location) {
        if (nameHeight <= room) return { name: size, location: WHERE.sizes[0] };
        continue;
      }
      const where = whereHeights.find((option) => option.fits && nameHeight + option.height <= room);
      if (where) return { name: size, location: where.size };
    }
  }
  // Too long even then: the clamps end it with an ellipsis.
  return { name: NAME.sizes[NAME.sizes.length - 1], location: WHERE.sizes[WHERE.sizes.length - 1] };
}

/**
 * Fits for every label text, measured once each. `measurer` goes on an empty
 * element the caller renders; `ready` is false while anything is unmeasured.
 */
export function useLabelFits(texts: readonly LabelText[]) {
  const measurer = useRef<HTMLDivElement>(null);
  const [fits, setFits] = useState<ReadonlyMap<string, LabelFit>>(() => new Map());
  const [fontsReady, setFontsReady] = useState(false);

  // Measured in the label's own fonts, so not before they have loaded; a
  // face that arrives later changes the metrics, so everything is measured
  // again.
  useEffect(() => {
    let alive = true;
    const refit = () => {
      if (!alive) return;
      setFits(new Map());
      setFontsReady(true);
    };
    void document.fonts.ready.then(refit);
    document.fonts.addEventListener("loadingdone", refit);
    return () => {
      alive = false;
      document.fonts.removeEventListener("loadingdone", refit);
    };
  }, []);

  const missing = useMemo(() => {
    const seen = new Set<string>();
    return texts.filter((text) => {
      const key = textKey(text);
      if (fits.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [texts, fits]);

  useEffect(() => {
    if (!fontsReady || missing.length === 0) return;
    const frame = requestAnimationFrame(() => {
      const root = measurer.current;
      if (!root) return;
      const measured = missing.map((text) => [textKey(text), measureFit(root, text)] as const);
      setFits((prev) => {
        const next = new Map(prev);
        for (const [key, fit] of measured) next.set(key, fit);
        return next;
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [fontsReady, missing]);

  return { fits, ready: fontsReady && missing.length === 0, measurer };
}

/**
 * One sheet. In the preview it also draws the paper — every label's die-cut —
 * which never prints. `offset` (millimetres) moves everything that prints, to
 * make up for a printer that lands it slightly off.
 */
export const LabelSheet = memo(function LabelSheet({
  slots,
  fits,
  outline,
  offset,
  preview = false,
}: {
  /** Thirty, across and then down; null leaves a label blank. */
  slots: readonly (PrintLabel | null)[];
  fits: ReadonlyMap<string, LabelFit>;
  /** Outline every label, for a test print on plain paper. */
  outline: boolean;
  offset: { x: number; y: number };
  preview?: boolean;
}) {
  return (
    <div className="qrl-sheet" data-outline={outline || undefined}>
      {preview && (
        <div className="qrl-paper">
          {slots.map((_, slot) => (
            <div key={slot} className="qrl-die" style={position(slot)} />
          ))}
        </div>
      )}
      <div
        className="qrl-ink"
        style={offset.x || offset.y ? { transform: `translate(${offset.x}mm, ${offset.y}mm)` } : undefined}
      >
        {slots.map((label, slot) =>
          label || outline ? (
            <div key={slot} className="qrl-slot" style={position(slot)}>
              {label && <LabelFace label={label} fit={fits.get(textKey(label)) ?? FALLBACK_FIT} />}
            </div>
          ) : null,
        )}
      </div>
    </div>
  );
});

function position(slot: number) {
  const { x, y } = slotOrigin(slot);
  return { left: inch(x), top: inch(y) };
}

const LabelFace = memo(function LabelFace({ label, fit }: { label: PrintLabel; fit: LabelFit }) {
  const { size, path } = label.code;
  return (
    <>
      <svg className="qrl-code" viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges" aria-hidden>
        <path d={path} fill="#000" />
      </svg>
      <div className="qrl-text">
        <p className="qrl-eyebrow">Scan for IT help</p>
        <p className="qrl-name" style={{ fontSize: `${fit.name}pt` }}>
          {label.name}
        </p>
        {label.location && (
          <p className="qrl-where" style={{ fontSize: `${fit.location}pt` }}>
            {label.location}
          </p>
        )}
      </div>
    </>
  );
});
