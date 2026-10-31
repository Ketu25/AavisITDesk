import { clip, oneLine } from "@/lib/quick-tickets";
import type { QuickTicketIcon } from "@/lib/constants";

/**
 * QR labels: a sticker for a quick-ticket group, put where its problems
 * happen — on the printer, by the meeting-room screen. Scanning it with a
 * phone camera opens that group's quick tickets, so reporting a paper jam is
 * a scan and a tap.
 *
 * Everything a label points at is in its address, so printing one stores
 * nothing: the group, and optionally where the label is stuck ("HP LaserJet ·
 * 2nd floor"). Both arrive from the outside world when it is scanned, so both
 * are checked again then, like anything else in an address.
 *
 * Pure and dependency-free: the scan route, the Quick tickets page and the
 * label printer all read it.
 */

/**
 * The longest "where it is" a label carries: two short lines under the
 * group's name, and few enough characters that the code stays coarse enough
 * to scan at label size.
 */
export const LABEL_LOCATION_MAX = 48;

/** Where the location rides in a label's own address: `/q/<group>?at=…`. */
export const SCAN_LOCATION_PARAM = "at";

/**
 * On the Quick tickets page: present when the visit came from a scanned
 * label, holding the label's location — empty when it has none.
 */
export const LABEL_PARAM = "label";

/**
 * Past this QR version (57 modules across) a module on a ¾" code is under
 * a third of a millimetre — too fine for an office printer to lay down and a
 * phone to read reliably. Only a long location written in a non-Latin
 * script, which an address carries at nine characters a letter, gets there.
 */
export const MAX_QR_VERSION = 10;

/**
 * A group a label can be printed for, and how it stands with requesters:
 * `live` is what they can reach now; a `hidden` group, or one with no live
 * quick tickets (`empty`), tells a scanner the label isn't in use. Only
 * admins see the last two — they may be labelling a group before it opens.
 */
export type LabelGroup = {
  id: string;
  name: string;
  icon: QuickTicketIcon;
  status: "live" | "hidden" | "empty";
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: string) => UUID.test(value);

/** A location as typed, or as it came in an address: one line, trimmed, no longer than a label carries. */
export function cleanLocation(raw: string | null | undefined) {
  return clip(oneLine(raw ?? ""), LABEL_LOCATION_MAX).trimEnd();
}

/**
 * The desk's public address, which every label's code starts with. The
 * configured one rather than the address bar's: a label printed from a
 * preview deployment, or from a laptop on localhost, must still open the
 * real desk — or say plainly that it can't.
 */
export function labelSiteUrl() {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  return typeof window === "undefined" ? "" : window.location.origin;
}

/** True when a phone that scans a label could never reach this address. */
export function isLocalAddress(siteUrl: string) {
  try {
    const host = new URL(siteUrl).hostname;
    return (
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host === "0.0.0.0" ||
      host === "[::1]" ||
      /^127\./.test(host)
    );
  } catch {
    return true;
  }
}

/**
 * The address a label's code holds. Short on purpose — every character makes
 * the code denser — so the location goes in as a query, where a space costs
 * one character ("+") rather than three.
 */
export function scanUrl(siteUrl: string, groupId: string, location: string) {
  const where = cleanLocation(location);
  const query = where ? `?${new URLSearchParams({ [SCAN_LOCATION_PARAM]: where })}` : "";
  return `${siteUrl.replace(/\/+$/, "")}/q/${groupId}${query}`;
}

/**
 * Where a scanned label sends someone: Quick tickets with its group open, and
 * the label's location along with it. A group id that isn't one still lands
 * there, marked as a label, so the page can say the label is out of date
 * rather than silently showing everything.
 */
export function scanDestination(groupId: string, location: string | null) {
  const params = new URLSearchParams();
  if (isUuid(groupId)) params.set("group", groupId.toLowerCase());
  params.set(LABEL_PARAM, cleanLocation(location));
  return `/quick-tickets?${params}`;
}

/**
 * What a quick ticket picked from a scanned label starts out saying. The
 * location answers the admin's question when there is one — "Which printer?"
 * — which also puts it in the ticket's title; with no question it opens the
 * note instead, so IT still learns where. Either way the requester sees it
 * and can change it before sending.
 */
export function labelPrefill(issue: { detail_prompt: string | null }, location: string) {
  const where = cleanLocation(location);
  if (!where) return { answer: "", note: "" };
  return issue.detail_prompt ? { answer: where, note: "" } : { answer: "", note: `Location: ${where}` };
}

// ------------------------------------------------------------------ sheet --

/**
 * Avery 5160 and its inkjet twin 8160 (Easy Peel address labels, 1" × 2⅝"):
 * US Letter, 30 labels in 3 columns of 10, numbered across and then down.
 * Inches, as Avery publishes them.
 */
export const AVERY_5160 = {
  pageWidth: 8.5,
  pageHeight: 11,
  columns: 3,
  rows: 10,
  labelWidth: 2.625,
  labelHeight: 1,
  marginTop: 0.5,
  marginLeft: 0.1875,
  /** Left edge to left edge: a label and the ⅛" gutter after it. */
  columnPitch: 2.75,
  /** Top edge to top edge: the rows touch. */
  rowPitch: 1,
  cornerRadius: 0.0625,
} as const;

export const LABELS_PER_SHEET = AVERY_5160.columns * AVERY_5160.rows;

/** Enough for any real batch; past it a mistyped count would draw thousands of codes. */
export const MAX_LABELS = LABELS_PER_SHEET * 10;

/** Top-left corner of a label on the sheet, in inches. `slot` counts from 0, across and then down. */
export function slotOrigin(slot: number) {
  const column = slot % AVERY_5160.columns;
  const row = Math.floor(slot / AVERY_5160.columns);
  return {
    x: AVERY_5160.marginLeft + column * AVERY_5160.columnPitch,
    y: AVERY_5160.marginTop + row * AVERY_5160.rowPitch,
  };
}

/**
 * Lays labels out across sheets. `spots` are where to print on the first
 * sheet — any of its labels (0-based, across then down), on a fresh sheet or
 * one that has had some peeled off — or none, to fill it from the top. Labels
 * take the spots in sheet order; any left over go on fresh sheets, from the
 * top. Spots past the last label stay blank.
 */
export function paginate<T>(labels: readonly T[], spots: readonly number[] = []): (T | null)[][] {
  const picked = [...new Set(spots)]
    .filter((slot) => Number.isInteger(slot) && slot >= 0 && slot < LABELS_PER_SHEET)
    .sort((a, b) => a - b);
  const everySlot = Array.from({ length: LABELS_PER_SHEET }, (_, slot) => slot);

  const sheets: (T | null)[][] = [];
  let next = 0;
  // Every sheet takes at least one label, so this ends.
  while (next < labels.length) {
    const sheet = Array<T | null>(LABELS_PER_SHEET).fill(null);
    for (const slot of sheets.length === 0 && picked.length > 0 ? picked : everySlot) {
      if (next === labels.length) break;
      sheet[slot] = labels[next++];
    }
    sheets.push(sheet);
  }
  return sheets;
}

/** A QR code's dark modules as one SVG path, in module units — one rectangle per run along a row. */
export function qrPath(modules: readonly (readonly boolean[])[]) {
  let d = "";
  modules.forEach((row, y) => {
    for (let x = 0; x < row.length; ) {
      if (!row[x]) {
        x++;
        continue;
      }
      let end = x + 1;
      while (end < row.length && row[end]) end++;
      d += `M${x} ${y}h${end - x}v1h${x - end}z`;
      x = end;
    }
  });
  return d;
}
