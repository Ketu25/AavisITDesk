"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { encode } from "uqr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Icons } from "@/components/shell/icons";
import { plural } from "@/components/admin/quick-tickets-shared";
import {
  AVERY_5160,
  LABELS_PER_SHEET,
  LABEL_LOCATION_MAX,
  MAX_LABELS,
  MAX_QR_VERSION,
  cleanLocation,
  isLocalAddress,
  labelSiteUrl,
  paginate,
  qrPath,
  scanUrl,
  type LabelGroup,
} from "@/lib/qr-labels";
import { cn } from "@/lib/utils";
import {
  LabelSheet,
  SHEET_CSS,
  textKey,
  useLabelFits,
  type LabelText,
  type PrintLabel,
  type QrCode,
} from "./sheet";

/** One line of the batch: a group, where its label goes, and how many. Copies stay text while being typed. */
type Row = { id: number; groupId: string; location: string; copies: string };

type Offset = { x: number; y: number };

const NO_OFFSET: Offset = { x: 0, y: 0 };
/** Millimetres. A printer further out than this needs fixing, not nudging. */
const OFFSET_LIMIT = 6;
const OFFSET_STEP = 0.5;
const OFFSET_KEY = "aavis.qr-labels.offset";

const EMPTY_SHEET: null[] = Array(LABELS_PER_SHEET).fill(null);

function clampOffset(value: number) {
  if (!Number.isFinite(value)) return 0;
  const stepped = Math.round(value / OFFSET_STEP) * OFFSET_STEP;
  return Math.min(Math.max(stepped, -OFFSET_LIMIT), OFFSET_LIMIT);
}

/** The nudge saved in this browser — it belongs to the printer this computer prints to. */
function readOffset(): Offset {
  try {
    const saved = JSON.parse(window.localStorage.getItem(OFFSET_KEY) ?? "null") as Partial<Offset> | null;
    if (saved && typeof saved.x === "number" && typeof saved.y === "number") {
      return { x: clampOffset(saved.x), y: clampOffset(saved.y) };
    }
  } catch {
    // Storage blocked, or something else wrote there: start square.
  }
  return NO_OFFSET;
}

function saveOffset(offset: Offset) {
  try {
    if (offset.x || offset.y) window.localStorage.setItem(OFFSET_KEY, JSON.stringify(offset));
    else window.localStorage.removeItem(OFFSET_KEY);
  } catch {
    // Not remembered next time; this print still uses it.
  }
}

function parseCopies(text: string) {
  const trimmed = text.trim();
  if (!/^\d{1,4}$/.test(trimmed)) return null;
  const count = Number(trimmed);
  return count >= 1 && count <= MAX_LABELS ? count : null;
}

/**
 * Medium error correction (15% of the code can be scuffed or covered),
 * raised further whenever that fits in the same size for free.
 */
function encodeUrl(url: string): QrCode | null {
  try {
    const qr = encode(url, { ecc: "M", boostEcc: true, border: 0 });
    return { path: qrPath(qr.data), size: qr.size, version: qr.version };
  } catch {
    return null;
  }
}

/**
 * Safari only honours `@page` from 18.2 on. Before that it prints with
 * margins of its own, and every label lands off its sticker. On an iPhone or
 * iPad every browser is Safari underneath, so there the system's version
 * decides. Advice only: nothing is stopped on the strength of a user agent.
 */
function isOldWebKit(userAgent: string) {
  const before = (major: number, minor: number) => major < 18 || (major === 18 && minor < 2);
  const ios = userAgent.match(/(?:iPhone|iPad|iPod).*? OS (\d+)_(\d+)/);
  if (ios) return before(Number(ios[1]), Number(ios[2]));
  if (!/Safari\//.test(userAgent) || /Chrome|Chromium|Edg\//.test(userAgent)) return false;
  const version = userAgent.match(/Version\/(\d+)(?:\.(\d+))?/);
  return version ? before(Number(version[1]), Number(version[2] ?? 0)) : false;
}

const describeStatus = (group: LabelGroup) =>
  group.status === "hidden"
    ? `${group.name} (hidden)`
    : group.status === "empty"
      ? `${group.name} (nothing live)`
      : group.name;

/**
 * The QR label printer: build a batch of labels — a group each, where it is
 * going, how many — see the sheet, and print it onto Avery 5160 labels.
 *
 * The sheet is laid out in real inches and printed straight from the page:
 * printing hides everything else and sets the paper to Letter with no
 * margins of its own. What only the print dialog can set — 100% scale, no
 * headers — is spelled out next to the button, with a plain-paper test
 * (outlines on) and a millimetre nudge, remembered per browser, for a
 * printer that lands a little off.
 *
 * Loaded in the browser only (see ./index.tsx).
 */
export function QrLabelsStudio({
  groups,
  initialGroupId,
  isAdmin,
  failed,
}: {
  groups: LabelGroup[];
  /** Asked for in the address — a group card's "Print QR labels". */
  initialGroupId: string | null;
  isAdmin: boolean;
  failed: boolean;
}) {
  const id = useId();
  const siteUrl = useMemo(() => labelSiteUrl(), []);
  // Only ever rendered in the browser (see ./index.tsx), so navigator is there.
  const [oldWebKit] = useState(() => isOldWebKit(navigator.userAgent));
  const groupById = useMemo(() => new Map(groups.map((group) => [group.id, group])), [groups]);

  const nextRowId = useRef(1);
  const [rows, setRows] = useState<Row[]>(() =>
    groups.length > 0
      ? [{ id: 0, groupId: initialGroupId ?? groups[0].id, location: "", copies: "1" }]
      : [],
  );
  /** Spots on the first sheet to print on (0-based, in sheet order); none fills it from the top. */
  const [picked, setPicked] = useState<readonly number[]>([]);
  const [outline, setOutline] = useState(false);
  const [offset, setOffset] = useState<Offset>(readOffset);
  const [page, setPage] = useState(0);
  /** A row whose location field should take focus once it is on screen. */
  const [focusRow, setFocusRow] = useState<number | null>(null);

  useEffect(() => {
    if (focusRow !== null) document.getElementById(`${id}-where-${focusRow}`)?.focus();
  }, [focusRow, id]);

  // ------------------------------------------------------------ derived --

  const prepared = useMemo(
    () =>
      rows.map((row) => {
        const group = groupById.get(row.groupId) ?? null;
        const location = cleanLocation(row.location);
        return {
          row,
          group,
          location,
          url: group ? scanUrl(siteUrl, group.id, location) : null,
          copies: parseCopies(row.copies),
        };
      }),
    [rows, groupById, siteUrl],
  );

  // Encoded once per distinct address — not per copy, and not again for
  // every keystroke in some other row.
  const urlKey = [...new Set(prepared.flatMap((entry) => (entry.url ? [entry.url] : [])))].join("\n");
  const codes = useMemo(() => {
    const map = new Map<string, QrCode | null>();
    for (const url of urlKey ? urlKey.split("\n") : []) map.set(url, encodeUrl(url));
    return map;
  }, [urlKey]);

  const checked = useMemo(
    () =>
      prepared.map((entry) => {
        const code = entry.url ? (codes.get(entry.url) ?? null) : null;
        return {
          ...entry,
          code,
          groupError: entry.group ? null : "Pick a group.",
          copiesError: entry.copies === null ? `A number from 1 to ${MAX_LABELS}.` : null,
          locationError:
            entry.group && (!code || code.version > MAX_QR_VERSION)
              ? "Too long for a code this small to scan — shorten it."
              : null,
        };
      }),
    [prepared, codes],
  );

  const total = checked.reduce((sum, entry) => sum + (entry.copies ?? 0), 0);
  const tooMany = total > MAX_LABELS;
  const rowsOk = checked.every((entry) => !entry.groupError && !entry.copiesError && !entry.locationError);

  const labels = useMemo(() => {
    if (tooMany) return [];
    const out: PrintLabel[] = [];
    for (const entry of checked) {
      if (!entry.group || !entry.url || !entry.code || entry.locationError || !entry.copies) continue;
      // One object for every copy: identical props, so a copy never redraws on its own.
      const label: PrintLabel = { url: entry.url, name: entry.group.name, location: entry.location, code: entry.code };
      for (let copy = 0; copy < entry.copies; copy++) out.push(label);
    }
    return out;
  }, [checked, tooMany]);

  // A stable list of the distinct texts, so the fitting only runs for new ones.
  const textsJson = JSON.stringify([
    ...new Map(labels.map((label) => [textKey(label), { name: label.name, location: label.location }])).values(),
  ]);
  const texts = useMemo(() => JSON.parse(textsJson) as LabelText[], [textsJson]);
  const { fits, ready: fitted, measurer } = useLabelFits(texts);

  const sheets = useMemo(() => paginate(labels, picked), [labels, picked]);
  const shown = Math.min(page, Math.max(sheets.length - 1, 0));
  const firstSheet = sheets[0] ?? EMPTY_SHEET;
  const onFirstSheet = firstSheet.filter(Boolean).length;
  const canPrint = rowsOk && !tooMany && labels.length > 0 && fitted;

  // -------------------------------------------------------------- edits --

  function update(rowId: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((row) => (row.id === rowId ? { ...row, ...patch } : row)));
  }

  /** A new line after `after` (or at the end) for the same group, ready to type where it goes. */
  function addRow(after?: Row) {
    const rowId = nextRowId.current++;
    setRows((prev) => {
      const index = after ? prev.findIndex((row) => row.id === after.id) : prev.length - 1;
      const base = after ?? prev[prev.length - 1];
      const next = [...prev];
      next.splice(index + 1, 0, {
        id: rowId,
        groupId: base?.groupId ?? groups[0]?.id ?? "",
        location: "",
        copies: "1",
      });
      return next;
    });
    setFocusRow(rowId);
  }

  function removeRow(rowId: number) {
    const index = rows.findIndex((row) => row.id === rowId);
    if (index < 0 || rows.length === 1) return;
    // Focus stays in the list rather than falling to the page with the button.
    setFocusRow((rows[index + 1] ?? rows[index - 1]).id);
    setRows((prev) => prev.filter((row) => row.id !== rowId));
  }

  function toggleSpot(slot: number) {
    setPicked((prev) =>
      prev.includes(slot) ? prev.filter((spot) => spot !== slot) : [...prev, slot].sort((a, b) => a - b),
    );
    // The spots are on the first sheet, so that is the one to watch them fill.
    setPage(0);
  }

  function nudge(next: Offset) {
    const clamped = { x: clampOffset(next.x), y: clampOffset(next.y) };
    setOffset(clamped);
    saveOffset(clamped);
  }

  async function print() {
    if (!canPrint) return;
    // The sheet was fitted in these fonts; never print it in a fallback.
    await document.fonts.ready;
    window.print();
  }

  // ------------------------------------------------------------- render --

  if (failed) {
    return (
      <div className="card flex flex-col items-center gap-3 px-4 py-10 text-center">
        <Icons.alert className="size-5 text-ink-faint" />
        <div>
          <p className="text-[0.875rem] font-medium text-ink">Couldn&apos;t load the groups</p>
          <p className="mt-1 text-[0.8125rem] text-ink-muted">Check your connection, then reload the page.</p>
        </div>
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="card flex flex-col items-center gap-3 px-4 py-12 text-center">
        <span className="flex size-11 items-center justify-center rounded-xl border border-line bg-surface text-ink-faint">
          <Icons.qr className="size-5" />
        </span>
        <div>
          <p className="text-[0.875rem] font-medium text-ink">No groups to label yet</p>
          <p className="mt-1 max-w-sm text-[0.8125rem] text-ink-muted text-pretty">
            {isAdmin
              ? "Add a quick-ticket group and its quick tickets first — a label opens a group."
              : "Once an admin has quick tickets live, their groups appear here to label."}
          </p>
        </div>
        {isAdmin && (
          <Link
            href="/admin/quick-tickets"
            className="inline-flex h-8 items-center gap-1.5 rounded-[9px] border border-line-strong bg-surface px-3 text-[0.8125rem] font-medium text-ink transition-colors hover:bg-surface-hover"
          >
            <Icons.wrench className="size-3.5" />
            Quick ticket setup
          </Link>
        )}
      </div>
    );
  }

  const sheetCount = sheets.length;
  const blocked = !rowsOk
    ? "Fix what's marked in red first."
    : tooMany
      ? `That's more than ${MAX_LABELS / LABELS_PER_SHEET} sheets at once — print them in batches.`
      : labels.length === 0
        ? "Add a label to print."
        : !fitted
          ? "Fitting the type…"
          : null;

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] xl:grid-cols-[minmax(0,1fr)_minmax(0,27rem)]">
      <style>{SHEET_CSS}</style>
      <div ref={measurer} className="qrl-measure" aria-hidden />

      <div className="min-w-0 space-y-5">
        {oldWebKit && (
          <div
            role="status"
            data-tone="amber"
            className="flex items-start gap-3 rounded-[14px] border border-[var(--tone-bd)] bg-[var(--tone-bg)] px-4 py-3"
          >
            <Icons.alert className="mt-0.5 size-4 flex-none text-[var(--tone-fg)]" />
            <p className="text-[0.8125rem] leading-relaxed text-ink-muted text-pretty">
              <span className="font-medium text-[var(--tone-fg)]">
                This browser adds its own page margins, so labels would print off their stickers.
              </span>{" "}
              Print them from Chrome, Edge or Firefox on a computer, or update Safari (or iOS) to 18.2 or
              later.
            </p>
          </div>
        )}
        {isLocalAddress(siteUrl) && (
          <div
            role="status"
            data-tone="amber"
            className="flex items-start gap-3 rounded-[14px] border border-[var(--tone-bd)] bg-[var(--tone-bg)] px-4 py-3"
          >
            <Icons.alert className="mt-0.5 size-4 flex-none text-[var(--tone-fg)]" />
            <p className="text-[0.8125rem] leading-relaxed text-ink-muted text-pretty">
              <span className="font-medium text-[var(--tone-fg)]">These codes would open </span>
              <span className="readout break-all text-ink">{siteUrl}</span>
              <span className="font-medium text-[var(--tone-fg)]">, which a phone can&apos;t reach.</span>{" "}
              Fine for trying the printer out; print the real labels from the live desk.
            </p>
          </div>
        )}

        {/* ----------------------------------------------------- labels -- */}
        <section aria-labelledby={`${id}-labels`} className="card p-4 sm:p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 id={`${id}-labels`} className="eyebrow">
              Labels
            </h2>
            <p className="text-xs text-ink-faint">
              {plural(total, "label")} · {plural(sheetCount, "sheet")}
            </p>
          </div>
          <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-ink-muted text-pretty">
            One line per label. Say where it&apos;s going and it prints under the group&apos;s name — and is
            filled in for whoever scans it, so IT knows which printer, which room.
          </p>

          <ol className="mt-4 space-y-2.5">
            {checked.map((entry, index) => {
              const { row } = entry;
              const whereId = `${id}-where-${row.id}`;
              const copiesId = `${id}-copies-${row.id}`;
              const groupId = `${id}-group-${row.id}`;
              const count = entry.copies ?? 0;
              const status = entry.group?.status ?? "live";
              const message =
                entry.groupError ??
                entry.locationError ??
                entry.copiesError ??
                (status === "hidden"
                  ? "This group is hidden from requesters. Until it's shown again, scanning the label says it isn't in use."
                  : status === "empty"
                    ? "Nothing in this group is live yet. Until something is, scanning the label says it isn't in use."
                    : null);
              const isError = Boolean(entry.groupError ?? entry.locationError ?? entry.copiesError);

              return (
                <li key={row.id} className="rounded-[12px] border border-line bg-surface-sunk/40 p-3">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2.5 sm:grid-cols-[minmax(0,10.5rem)_minmax(0,1fr)_auto_auto]">
                    <div className="col-span-2 min-w-0 space-y-1 sm:col-span-1">
                      <label htmlFor={groupId} className="block text-[0.6875rem] font-medium text-ink-faint">
                        Group
                      </label>
                      <Select
                        id={groupId}
                        value={row.groupId}
                        aria-invalid={entry.groupError ? true : undefined}
                        onChange={(event) => update(row.id, { groupId: event.target.value })}
                      >
                        {!entry.group && <option value="">Pick a group</option>}
                        {groups.map((group) => (
                          <option key={group.id} value={group.id}>
                            {describeStatus(group)}
                          </option>
                        ))}
                      </Select>
                    </div>

                    <div className="col-span-2 min-w-0 space-y-1 sm:col-span-1">
                      <label htmlFor={whereId} className="block text-[0.6875rem] font-medium text-ink-faint">
                        Where it goes <span className="font-normal">(optional)</span>
                      </label>
                      <Input
                        id={whereId}
                        value={row.location}
                        maxLength={LABEL_LOCATION_MAX}
                        placeholder="e.g. HP LaserJet · 2nd floor"
                        autoComplete="off"
                        enterKeyHint="next"
                        aria-invalid={entry.locationError ? true : undefined}
                        aria-describedby={message ? `${whereId}-message` : undefined}
                        onChange={(event) => update(row.id, { location: event.target.value })}
                        onKeyDown={(event) => {
                          // Enter starts the next label for the same group: a
                          // floor's worth of printers is typed in one go.
                          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                            event.preventDefault();
                            addRow(row);
                          }
                        }}
                      />
                    </div>

                    <div className="space-y-1">
                      <label htmlFor={copiesId} className="block text-[0.6875rem] font-medium text-ink-faint">
                        Copies
                      </label>
                      <div className="flex items-center gap-1">
                        <StepButton
                          label={`One fewer of label ${index + 1}`}
                          disabled={count <= 1}
                          onClick={() => update(row.id, { copies: String(Math.max(1, count - 1)) })}
                        >
                          <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden>
                            <path d="M3.5 8h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                          </svg>
                        </StepButton>
                        <Input
                          id={copiesId}
                          value={row.copies}
                          inputMode="numeric"
                          autoComplete="off"
                          aria-invalid={entry.copiesError ? true : undefined}
                          onChange={(event) => update(row.id, { copies: event.target.value.replace(/[^\d]/g, "") })}
                          onBlur={() => {
                            if (entry.copies !== null) update(row.id, { copies: String(entry.copies) });
                          }}
                          className="readout w-14 px-1 text-center"
                        />
                        <StepButton
                          label={`One more of label ${index + 1}`}
                          disabled={count >= MAX_LABELS}
                          onClick={() => update(row.id, { copies: String(Math.min(MAX_LABELS, count + 1)) })}
                        >
                          <Icons.plus className="size-3.5" />
                        </StepButton>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => removeRow(row.id)}
                      disabled={rows.length === 1}
                      aria-label={`Remove label ${index + 1}`}
                      title={rows.length === 1 ? "There has to be at least one label" : "Remove this label"}
                      className={cn(
                        "flex size-11 items-center justify-center justify-self-end rounded-[10px] text-ink-faint transition-colors sm:size-9",
                        "hover:bg-surface-hover hover:text-ink disabled:pointer-events-none disabled:opacity-30",
                      )}
                    >
                      <Icons.close className="size-4" />
                    </button>
                  </div>

                  {message && (
                    <p
                      id={`${whereId}-message`}
                      role={isError ? "alert" : undefined}
                      data-tone={isError ? "rose" : "amber"}
                      className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-[var(--tone-fg)]"
                    >
                      <Icons.alert className="mt-px size-3.5 flex-none" />
                      {message}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>

          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            <Button type="button" size="sm" icon={<Icons.plus className="size-3.5" />} onClick={() => addRow()}>
              Add a label
            </Button>
            <span className="text-xs text-ink-faint">Or press Enter in “Where it goes”.</span>
          </div>
          {tooMany && (
            <p role="alert" data-tone="rose" className="mt-3 text-xs text-[var(--tone-fg)]">
              That&apos;s {total} labels. Up to {MAX_LABELS} — {MAX_LABELS / LABELS_PER_SHEET} sheets — go in one print.
            </p>
          )}
        </section>

        {/* ------------------------------------------------------ sheet -- */}
        <section aria-labelledby={`${id}-sheet`} className="card p-4 sm:p-5">
          <h2 id={`${id}-sheet`} className="eyebrow">
            Sheet
          </h2>
          <div className="mt-3 grid gap-x-8 gap-y-5 sm:grid-cols-[auto_minmax(0,1fr)]">
            <div className="min-w-0">
              <p id={`${id}-spots`} className="text-[0.8125rem] font-medium text-ink">
                Where on the sheet
              </p>
              <p className="mt-0.5 max-w-[16rem] text-xs leading-relaxed text-ink-faint">
                Click the spots to print on — any you like, on a fresh sheet or a used one. Labels fill
                them top to bottom, in the order listed.
              </p>
              <SpotPicker
                picked={picked}
                placed={firstSheet}
                onToggle={toggleSpot}
                labelledBy={`${id}-spots`}
                describedBy={`${id}-spots-status`}
              />
              <p
                id={`${id}-spots-status`}
                aria-live="polite"
                className="mt-2.5 max-w-[16rem] text-xs leading-relaxed text-ink-muted"
              >
                {describePlacement({
                  total: labels.length,
                  picked: picked.length,
                  onFirst: onFirstSheet,
                  laterSheets: Math.max(sheets.length - 1, 0),
                })}
              </p>
              {picked.length > 0 && (
                <Button type="button" size="sm" variant="ghost" onClick={() => setPicked([])} className="-ml-2.5 mt-1">
                  Fill from spot 1 instead
                </Button>
              )}
            </div>

            <div className="space-y-5">
              <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-line bg-surface-sunk p-3">
                <input
                  type="checkbox"
                  checked={outline}
                  onChange={(event) => setOutline(event.target.checked)}
                  className="mt-0.5 size-3.5 accent-[var(--accent)]"
                />
                <span className="min-w-0">
                  <span className="block text-[0.8125rem] font-medium text-ink">Outline every label</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-ink-faint">
                    For a test on plain paper: hold it behind a label sheet against the light to see that
                    it lines up. Turn it off for the real thing.
                  </span>
                </span>
              </label>

              <fieldset>
                <legend className="text-[0.8125rem] font-medium text-ink">Printer alignment</legend>
                <p className="mt-0.5 text-xs leading-relaxed text-ink-faint">
                  Only if a test print lands off the labels. Remembered in this browser.
                </p>
                <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-2.5">
                  <Nudge
                    axis="x"
                    value={offset.x}
                    onChange={(x) => nudge({ ...offset, x })}
                  />
                  <Nudge
                    axis="y"
                    value={offset.y}
                    onChange={(y) => nudge({ ...offset, y })}
                  />
                  {(offset.x !== 0 || offset.y !== 0) && (
                    <Button type="button" size="sm" variant="ghost" onClick={() => nudge(NO_OFFSET)}>
                      Reset
                    </Button>
                  )}
                </div>
              </fieldset>
            </div>
          </div>
        </section>

        {/* --------------------------------------------------- printing -- */}
        <section aria-labelledby={`${id}-how`} className="card p-4 sm:p-5">
          <h2 id={`${id}-how`} className="eyebrow">
            Printing them
          </h2>
          <ol className="mt-3 list-decimal space-y-2 pl-4 text-[0.8125rem] leading-relaxed text-ink-muted marker:text-ink-faint">
            <li>
              <span className="font-medium text-ink">Avery 5160 or 8160 sheets</span> — US Letter, 30 labels of
              1″ × 2⅝″. Laser sheets in a laser printer, inkjet sheets in an inkjet.
            </li>
            <li>
              <span className="font-medium text-ink">In the print dialog</span>, set scale to 100% or “Actual
              size” — not “Fit to page” — paper to Letter, and turn headers and footers off.
            </li>
            <li>
              <span className="font-medium text-ink">Test on plain paper first</span>, with outlines on. If it
              lands off, nudge it above and test again.
            </li>
            <li>
              <span className="font-medium text-ink">Scanning opens</span>{" "}
              <span className="readout break-all text-ink">{siteUrl}</span>. The first scan on a phone asks for
              sign-in, then goes straight to the group.
            </li>
          </ol>
        </section>
      </div>

      {/* ------------------------------------------------------- preview -- */}
      <aside aria-labelledby={`${id}-preview`} className="card min-w-0 p-4 sm:p-5 lg:sticky lg:top-20">
        <div className="flex min-h-7 items-center justify-between gap-3">
          <h2 id={`${id}-preview`} className="eyebrow">
            Preview
          </h2>
          {sheetCount > 1 && (
            <div className="flex items-center gap-1">
              <StepButton label="Previous sheet" disabled={shown === 0} onClick={() => setPage(shown - 1)}>
                <Icons.arrowLeft className="size-3.5" />
              </StepButton>
              <span className="readout min-w-[4.5rem] text-center text-xs text-ink-muted" aria-live="polite">
                {shown + 1} of {sheetCount}
              </span>
              <StepButton
                label="Next sheet"
                disabled={shown >= sheetCount - 1}
                onClick={() => setPage(shown + 1)}
              >
                <Icons.arrowRight className="size-3.5" />
              </StepButton>
            </div>
          )}
        </div>

        <SheetPreview
          label={
            labels.length === 0
              ? "An empty sheet."
              : `Sheet ${shown + 1} of ${sheetCount}: ${plural(
                  (sheets[shown] ?? EMPTY_SHEET).filter(Boolean).length,
                  "label",
                )}.`
          }
        >
          <LabelSheet slots={sheets[shown] ?? EMPTY_SHEET} fits={fits} outline={outline} offset={offset} preview />
        </SheetPreview>

        <p className="mt-3 text-xs text-ink-faint">
          {labels.length === 0
            ? "Nothing on the sheet yet."
            : `${plural(labels.length, "label")} on ${plural(sheetCount, "sheet")}${
                picked.length > 0 ? ", sheet 1 in the spots you picked" : ""
              }.`}
        </p>
        <Button
          type="button"
          variant="primary"
          size="lg"
          icon={<Icons.printer className="size-4" />}
          disabled={!canPrint}
          onClick={() => void print()}
          className="mt-3 w-full"
        >
          {labels.length > 0 ? `Print ${plural(labels.length, "label")}` : "Print"}
        </Button>
        <p className="mt-2 text-center text-[0.6875rem] leading-relaxed text-ink-faint" aria-live="polite">
          {blocked ?? "Letter paper · scale 100% · no headers or footers"}
        </p>
      </aside>

      {/* What actually prints: every sheet, at full size, as the page's only
          content. Hidden on screen. */}
      {createPortal(
        <div className="qrl-print" aria-hidden>
          {canPrint ? (
            sheets.map((slots, index) => (
              <LabelSheet key={index} slots={slots} fits={fits} outline={outline} offset={offset} />
            ))
          ) : (
            <p className="qrl-print-empty">Nothing to print yet. Finish the labels on screen, then print again.</p>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}

// ----------------------------------------------------------------- parts --

function StepButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex size-11 flex-none items-center justify-center rounded-[10px] border border-line bg-surface text-ink-muted sm:size-9",
        "transition-colors hover:bg-surface-hover hover:text-ink disabled:pointer-events-none disabled:opacity-35",
      )}
    >
      {children}
    </button>
  );
}

/** The sheet at its real size, scaled down to the width it is given. */
function SheetPreview({ label, children }: { label: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const sheetWidth = AVERY_5160.pageWidth * 96;
  return (
    <div ref={ref} className="mt-3 w-full">
      <div
        role="img"
        aria-label={label}
        className="relative aspect-[8.5/11] w-full overflow-hidden rounded-[6px] bg-white shadow-[var(--shadow-md)] ring-1 ring-line"
      >
        {width > 0 && (
          <div
            aria-hidden
            style={{ width: sheetWidth, transform: `scale(${width / sheetWidth})`, transformOrigin: "0 0" }}
          >
            {children}
          </div>
        )}
      </div>
    </div>
  );
}

/** Where the batch lands, in words — said under the spots after every pick. */
function describePlacement({
  total,
  picked,
  onFirst,
  laterSheets,
}: {
  total: number;
  /** How many spots are picked; none fills the first sheet from the top. */
  picked: number;
  onFirst: number;
  laterSheets: number;
}) {
  const rest = total - onFirst;
  const later = laterSheets === 1 ? "the next sheet" : `the next ${laterSheets} sheets`;

  if (picked === 0) {
    if (total === 0) return "Nothing to place yet. With no spots picked, labels fill from spot 1.";
    return (
      `Filling from spot 1${rest > 0 ? `, with ${rest} more on ${later}` : ""}. ` +
      "Click any spots to print there instead."
    );
  }
  if (total === 0) return `${plural(picked, "spot")} picked. Add a label to fill ${picked === 1 ? "it" : "them"}.`;

  const parts = [`${onFirst} of ${plural(total, "label")} in the spots you picked.`];
  if (rest > 0) {
    const room = LABELS_PER_SHEET - picked;
    parts.push(
      `${rest} more ${rest === 1 ? "goes" : "go"} on ${later}` +
        (room >= rest ? ` — or pick ${plural(rest, "more spot")} to keep ${rest === 1 ? "it" : "them"} on this one.` : "."),
    );
  }
  const spare = picked - onFirst;
  if (spare > 0) parts.push(`${plural(spare, "picked spot")} ${spare === 1 ? "stays" : "stay"} blank.`);
  return parts.join(" ");
}

/**
 * The first sheet's 30 labels as a little sheet: click any spots to print on
 * them, again to give one back. Labels fill the picked spots top to bottom;
 * with none picked they fill from spot 1, drawn lighter. Arrow keys move
 * across and down it as they would over the sheet; Space or Enter picks.
 */
function SpotPicker({
  picked,
  placed,
  onToggle,
  labelledBy,
  describedBy,
}: {
  picked: readonly number[];
  /** What lands on each spot of the first sheet, across and then down. */
  placed: readonly (PrintLabel | null)[];
  onToggle: (slot: number) => void;
  labelledBy: string;
  describedBy: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  /** The one spot Tab lands on, kept where focus last was. */
  const [focusSlot, setFocusSlot] = useState(0);
  const { columns } = AVERY_5160;

  function moveTo(slot: number) {
    const next = Math.min(Math.max(slot, 0), LABELS_PER_SHEET - 1);
    setFocusSlot(next);
    ref.current?.querySelector<HTMLElement>(`[data-slot="${next + 1}"]`)?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const step: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -columns,
      ArrowDown: columns,
    };
    if (event.key in step) {
      event.preventDefault();
      moveTo(focusSlot + step[event.key]);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      moveTo(event.key === "Home" ? 0 : LABELS_PER_SHEET - 1);
    }
  }

  return (
    <div
      ref={ref}
      role="group"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      onKeyDown={onKeyDown}
      className="mt-3 grid w-fit grid-cols-3 gap-1 rounded-[10px] border border-line bg-white p-2 dark:bg-surface-sunk"
    >
      {placed.map((label, slot) => {
        const isPicked = picked.includes(slot);
        const number = slot + 1;
        const what = label
          ? `prints ${label.name}${label.location ? ` · ${label.location}` : ""}`
          : isPicked
            ? "picked, but no label is left for it"
            : "left blank";
        return (
          <button
            key={slot}
            type="button"
            data-slot={number}
            aria-pressed={isPicked}
            aria-label={`Label ${number}, row ${Math.floor(slot / columns) + 1}, column ${(slot % columns) + 1}: ${what}`}
            title={`${number}: ${what}`}
            tabIndex={slot === focusSlot ? 0 : -1}
            onFocus={() => setFocusSlot(slot)}
            onClick={() => onToggle(slot)}
            className={cn(
              "readout flex h-7 w-[4.6rem] items-center justify-center rounded-[3px] border text-[0.625rem] leading-none sm:h-[1.375rem] sm:w-[3.6rem]",
              "transition-colors duration-150",
              label && isPicked
                ? "border-accent bg-accent text-[var(--accent-ink)]"
                : label
                  ? "border-accent-line bg-accent-soft text-accent hover:border-accent"
                  : isPicked
                    ? "border-dashed border-accent bg-surface text-accent"
                    : "border-line bg-surface text-ink-faint hover:border-accent-line hover:text-ink",
            )}
          >
            {number}
          </button>
        );
      })}
    </div>
  );
}

/** Moves everything printed by half a millimetre at a time, across or down. */
function Nudge({ axis, value, onChange }: { axis: "x" | "y"; value: number; onChange: (value: number) => void }) {
  const [less, more] = axis === "x" ? ["left", "right"] : ["up", "down"];
  const reading = value === 0 ? "Not moved" : `${Math.abs(value).toFixed(1)} mm ${value < 0 ? less : more}`;
  const arrow = (direction: string) => (
    <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden>
      <path
        d={
          direction === "left"
            ? "M10 3.5 5.5 8l4.5 4.5"
            : direction === "right"
              ? "M6 3.5 10.5 8 6 12.5"
              : direction === "up"
                ? "M3.5 10 8 5.5l4.5 4.5"
                : "M3.5 6 8 10.5 12.5 6"
        }
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );

  return (
    <div role="group" aria-label={axis === "x" ? "Across" : "Up and down"} className="flex items-center gap-1.5">
      <span aria-hidden className="w-12 text-[0.6875rem] font-medium text-ink-faint">
        {axis === "x" ? "Across" : "Up/down"}
      </span>
      <StepButton label={`Move ${less} half a millimetre`} disabled={value <= -OFFSET_LIMIT} onClick={() => onChange(value - OFFSET_STEP)}>
        {arrow(less)}
      </StepButton>
      <span className="readout min-w-[6.5rem] text-center text-xs text-ink-muted" aria-live="polite">
        {reading}
      </span>
      <StepButton label={`Move ${more} half a millimetre`} disabled={value >= OFFSET_LIMIT} onClick={() => onChange(value + OFFSET_STEP)}>
        {arrow(more)}
      </StepButton>
    </div>
  );
}
