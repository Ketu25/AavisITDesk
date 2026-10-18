"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useIsPresent, type MotionValue } from "motion/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Switch } from "@/components/ui/field";
import { TimeAgo } from "@/components/ui/time-ago";
import { useMediaQuery } from "@/components/ui/use-media-query";
import { useToast } from "@/components/ui/toast";
import { Icons } from "@/components/shell/icons";
import { QuickIcon } from "@/components/quick-tickets/icon";
import { MorphPopup, type Arrival } from "@/components/quick-tickets/morph-popup";
import { useSpotlight } from "@/components/quick-tickets/spotlight";
import { api, ApiClientError } from "@/lib/api";
import {
  PRIORITY_META,
  QUICK_ICON_LABEL,
  QUICK_TICKET_ICONS,
  QUICK_TICKET_LIMITS,
  type QuickTicketIcon,
} from "@/lib/constants";
import { charCount, effectivePriority, isQuickIcon } from "@/lib/quick-tickets";
import { ease, spring, stagger } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { QuickTicket, QuickTicketGroup, TicketPriority } from "@/lib/database.types";
import { Banner, QuickTicketEditor, type EditorRequest } from "./quick-ticket-editor";
import {
  groupStats,
  plural,
  type Act,
  type Guard,
  type QuickUsage,
  type RegisterGuard,
  type RuleOption,
} from "./quick-tickets-shared";
import { useSavedOrder } from "./use-saved-order";

/** What the pop-up opens on: the group's quick tickets, or straight into its details. */
export type GroupPopupStart = "list" | "details" | "delete";

type View =
  | { kind: "list" }
  | { kind: "item"; request: EditorRequest; key: number }
  | { kind: "details"; armDelete: boolean; key: number };

/** Where focus lands on the list when a step is left: what opened it. */
const returnTarget = (view: View) =>
  view.kind === "details"
    ? "details"
    : view.kind === "item" && view.request.mode === "edit"
      ? `item:${view.request.id}`
      : "add";

/**
 * A quick-ticket group in Quick ticket setup, opened: its card grows into a
 * pop-up, the same way the Quick tickets page opens a group for requesters,
 * and the admin manages it there — the quick tickets in it (their order,
 * live or hidden, and each one's editor) and the group itself (name,
 * description, icon, live or hidden, delete).
 *
 * The editor and the group's details are steps that slide in inside the
 * pop-up, never a second dialog on top. Each step guards its unsaved changes:
 * Back, Cancel, Escape, the close button, the backdrop and dragging the sheet
 * away are all run past it, and the first try asks before anything is lost.
 *
 * Loaded on demand and kept out of the server render, like the requester's.
 */
export function QuickGroupPopup({
  group,
  items,
  allItems,
  groups,
  rules,
  usage,
  usageKnown,
  position,
  total,
  busy,
  act,
  start,
  getCard,
  onHide,
  onClose,
  onDeleted,
}: {
  group: QuickTicketGroup;
  /** This group's quick tickets, in the server's order. */
  items: QuickTicket[];
  /** Every quick ticket: one being edited may have been moved to another group meanwhile. */
  allItems: QuickTicket[];
  /** Every group, in order, for the editor's group picker. */
  groups: QuickTicketGroup[];
  rules: RuleOption[];
  usage: Record<string, QuickUsage>;
  usageKnown: boolean;
  /** Where the group sits among the groups, from 1. */
  position: number;
  total: number;
  busy: string | null;
  act: Act;
  start: GroupPopupStart;
  getCard: (groupId: string) => HTMLElement | null;
  onHide: (groupId: string, hidden: boolean) => void;
  /** Close the pop-up; the grid takes the group out of the address. */
  onClose: () => void;
  /** The group was deleted from here: it goes without landing back in a card that is about to go too. */
  onDeleted: () => void;
}) {
  const isPresent = useIsPresent();
  const id = useId();
  const ruleById = new Map(rules.map((rule) => [rule.id, rule]));

  const [view, setView] = useState<View>(() =>
    start === "list" ? { kind: "list" } : { kind: "details", armDelete: start === "delete", key: 1 },
  );
  /** Which way the views slide: 1 on to a step, -1 back to the list, 0 for the first view. */
  const [dir, setDir] = useState(0);
  const nextKey = useRef(1);
  /** What to focus as the list comes back — a fresh object per return, so it acts every time. */
  const [returnTo, setReturnTo] = useState<{ target: string } | null>(null);
  const [announcement, setAnnouncement] = useState("");

  // ---------------------------------------------------------- the guard --

  const guardRef = useRef<Guard | null>(null);
  const registerGuard = useCallback<RegisterGuard>((guard) => {
    guardRef.current = guard;
    return () => {
      if (guardRef.current === guard) guardRef.current = null;
    };
  }, []);
  /** Runs `proceed` once the open step, if any, has agreed to being left. */
  const attempt = useCallback((proceed: () => void, kind: "back" | "close") => {
    const guard = guardRef.current;
    if (guard) guard(proceed, kind);
    else proceed();
  }, []);

  // --------------------------------------------------------------- views --

  const show = useCallback(
    (next: View) => {
      // Leaving, it shrinks away showing what it showed.
      if (!isPresent) return;
      setDir(next.kind === "list" ? -1 : 1);
      setView(next);
    },
    [isPresent],
  );

  const toList = useCallback(
    (target: string) => {
      setReturnTo({ target });
      show({ kind: "list" });
    },
    [show],
  );

  const back = useCallback(() => attempt(() => toList(returnTarget(view)), "back"), [attempt, toList, view]);
  const close = useCallback(() => attempt(onClose, "close"), [attempt, onClose]);
  const onEscape = useCallback(() => (view.kind === "list" ? close() : back()), [view.kind, close, back]);

  const openItem = useCallback(
    (request: EditorRequest) => show({ kind: "item", request, key: ++nextKey.current }),
    [show],
  );
  const openDetails = useCallback(
    () => show({ kind: "details", armDelete: false, key: ++nextKey.current }),
    [show],
  );

  // ------------------------------------------------------------- order --

  const byId = new Map(items.map((item) => [item.id, item]));
  // Held here rather than in the list, so a move still being saved survives
  // a trip into the editor and back.
  const itemOrder = useSavedOrder(
    items.map((item) => item.id),
    items.map((item) => `${item.id}:${item.sort_order}`).join("|"),
    (ids) => api("/api/admin/quick-tickets/order", { method: "PUT", json: { group_id: group.id, ids } }),
  );
  const ordered = itemOrder.orderIds.map((itemId) => byId.get(itemId)).filter((item) => item !== undefined);

  const moveItem = (item: QuickTicket, delta: -1 | 1) => {
    const ids = itemOrder.move(item.id, delta);
    if (ids) setAnnouncement(`${item.label} moved to position ${ids.indexOf(item.id) + 1} of ${ids.length}.`);
  };

  const listTitle = `${id}-list-title`;
  const listHint = `${id}-list-hint`;
  const stepTitle = `${id}-step-title`;
  const stepHint = `${id}-step-hint`;
  const stats = groupStats(group, items, ruleById, usage);
  /** What its card would list were it live: live quick tickets in live categories. */
  const shown = items.filter((item) => item.is_active && ruleById.get(item.routing_rule_id)?.is_active);
  const editingId = view.kind === "item" && view.request.mode === "edit" ? view.request.id : null;

  return (
    <MorphPopup
      cardId={group.id}
      icon={group.icon}
      getCard={getCard}
      onHide={onHide}
      onClose={close}
      onEscape={onEscape}
      labelledBy={view.kind === "list" ? listTitle : stepTitle}
      describedBy={view.kind === "list" ? listHint : stepHint}
      viewKey={view.kind === "list" ? "list" : `${view.kind}-${view.key}`}
      dir={dir}
      className="max-w-[48rem]"
      renderView={(morph) =>
        view.kind === "item" ? (
          <QuickTicketEditor
            session={view.request}
            // Read live, so another admin's change — or a delete — shows up
            // in an editor that is already open.
            item={editingId ? (allItems.find((item) => item.id === editingId) ?? null) : null}
            groups={groups}
            rules={rules}
            usage={editingId ? (usage[editingId] ?? null) : null}
            usageKnown={usageKnown}
            onBack={back}
            onClose={close}
            onDone={() => toList(returnTarget(view))}
            registerGuard={registerGuard}
            containerRef={morph.panelRef}
            titleId={stepTitle}
            hintId={stepHint}
            sheet={morph.sheet}
            onHeaderPointerDown={morph.dragHeader}
            className={morph.capClass}
            style={morph.capStyle}
          />
        ) : view.kind === "details" ? (
          <GroupDetails
            group={group}
            items={items}
            shown={shown}
            stats={stats}
            usageKnown={usageKnown}
            armDelete={view.armDelete}
            onBack={back}
            onClose={close}
            onDone={() => toList("details")}
            onDeleted={onDeleted}
            onGone={onClose}
            registerGuard={registerGuard}
            containerRef={morph.panelRef}
            titleId={stepTitle}
            hintId={stepHint}
            sheet={morph.sheet}
            onHeaderPointerDown={morph.dragHeader}
            className={morph.capClass}
            style={morph.capStyle}
          />
        ) : (
          <ManageList
            group={group}
            items={ordered}
            itemCount={items.length}
            ruleById={ruleById}
            usage={usage}
            usageKnown={usageKnown}
            stats={stats}
            position={position}
            total={total}
            busy={busy}
            act={act}
            announcement={announcement}
            titleId={listTitle}
            hintId={listHint}
            iconRef={morph.iconRef}
            iconOpacity={morph.iconOpacity}
            // Growing out of the card, it plays once it has landed instead.
            playIcon={dir !== 0 || morph.arrival !== "grow"}
            entrance={dir === 0 ? morph.arrival : "back"}
            returnTo={returnTo}
            reduced={morph.reduced}
            sheet={morph.sheet}
            className={morph.capClass}
            style={morph.capStyle}
            onHeaderPointerDown={morph.dragHeader}
            onMove={moveItem}
            onEdit={(item) => openItem({ mode: "edit", id: item.id, groupId: item.group_id })}
            onAdd={() => openItem({ mode: "create", groupId: group.id })}
            onEditDetails={openDetails}
            onClose={close}
          />
        )
      }
    />
  );
}

/** Rendered by the card grid once the page is idle, purely so this module is fetched before the first click. */
export function Preload() {
  return null;
}

// ------------------------------------------------------------------ list --

function ManageList({
  group,
  items,
  itemCount,
  ruleById,
  usage,
  usageKnown,
  stats,
  position,
  total,
  busy,
  act,
  announcement,
  titleId,
  hintId,
  iconRef,
  iconOpacity,
  playIcon,
  entrance,
  returnTo,
  reduced,
  sheet,
  className,
  style,
  onHeaderPointerDown,
  onMove,
  onEdit,
  onAdd,
  onEditDetails,
  onClose,
}: {
  group: QuickTicketGroup;
  /** In the order on show, a move still being saved included. */
  items: QuickTicket[];
  itemCount: number;
  ruleById: Map<string, RuleOption>;
  usage: Record<string, QuickUsage>;
  usageKnown: boolean;
  stats: ReturnType<typeof groupStats>;
  position: number;
  total: number;
  busy: string | null;
  act: Act;
  announcement: string;
  titleId: string;
  hintId: string;
  iconRef: React.RefObject<HTMLSpanElement | null>;
  iconOpacity: MotionValue<number>;
  playIcon: boolean;
  entrance: Arrival | "back";
  returnTo: { target: string } | null;
  reduced: boolean;
  sheet: boolean;
  className?: string;
  style?: React.CSSProperties;
  onHeaderPointerDown?: (event: React.PointerEvent) => void;
  onMove: (item: QuickTicket, delta: -1 | 1) => void;
  onEdit: (item: QuickTicket) => void;
  onAdd: () => void;
  onEditDetails: () => void;
  onClose: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  useSpotlight(listRef);

  // Back from a step, focus returns to what opened it — or, if that has
  // gone meanwhile (deleted, moved to another group), to adding one.
  useEffect(() => {
    if (!returnTo) return;
    const root = rootRef.current;
    const target =
      root?.querySelector<HTMLElement>(`[data-return="${CSS.escape(returnTo.target)}"]`) ??
      root?.querySelector<HTMLElement>('[data-return="add"]');
    if (!target) return;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: "nearest" });
  }, [returnTo]);

  /** Where the content's entrance starts: after the card has grown into room for it. */
  const startAt = entrance === "grow" ? 0.14 : entrance === "back" ? 0 : 0.05;
  const rise = (delay: number) =>
    reduced
      ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.16, delay } }
      : {
          initial: { opacity: 0, y: 6 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.26, ease: ease.entrance, delay },
        };

  const toggling = busy === `toggle-group-${group.id}`;

  return (
    <div ref={rootRef} style={style} className={cn("flex flex-col", className)}>
      <div
        onPointerDown={onHeaderPointerDown}
        className={cn(
          "flex flex-none items-start gap-3.5 px-5 pb-4",
          sheet ? "pt-1" : "pt-5",
          onHeaderPointerDown && "touch-none",
        )}
      >
        {/* What the card's icon flies up into. Plays its problem as it arrives, and again on hover. */}
        <motion.span
          ref={iconRef}
          data-play={playIcon || undefined}
          style={{ opacity: iconOpacity }}
          className="glyph-host flex size-11 flex-none items-center justify-center rounded-[12px] bg-accent text-[var(--accent-ink)] shadow-[var(--shadow-sm)]"
        >
          <QuickIcon name={group.icon} className="size-[1.25rem]" />
        </motion.span>
        <motion.div {...rise(startAt)} className="min-w-0 flex-1 pt-0.5">
          <p className="eyebrow">
            Group {position} of {total} · {plural(itemCount, "quick ticket")}
          </p>
          <h2
            id={titleId}
            className="mt-1 break-words text-[1.0625rem] font-semibold leading-snug tracking-tight text-ink"
          >
            {group.name}
          </h2>
          <p
            id={hintId}
            className={cn(
              "mt-0.5 break-words text-[0.8125rem] text-pretty",
              group.description ? "text-ink-muted" : "italic text-ink-faint",
            )}
          >
            {group.description ?? "No description"}
          </p>
        </motion.div>
        <motion.div {...rise(startAt)} className="-mr-1.5 flex flex-none items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            data-return="details"
            onClick={onEditDetails}
            aria-label={`Edit ${group.name}'s name, description and icon`}
            title="Edit name, description and icon"
          >
            Edit group
          </Button>
          <button
            type="button"
            onClick={onClose}
            aria-label={`Close ${group.name}`}
            className="tap-safe flex size-8 flex-none items-center justify-center rounded-[9px] text-ink-faint transition-colors hover:bg-surface-hover hover:text-ink"
          >
            <Icons.close className="size-4" />
          </button>
        </motion.div>
      </div>

      <motion.div
        {...rise(startAt + 0.04)}
        className="flex flex-none flex-wrap items-center gap-x-3 gap-y-1.5 px-5 pb-3 text-[0.75rem] text-ink-muted"
      >
        <GroupStatus group={group} reachable={stats.reachable} />
        <span>
          {itemCount === 0
            ? "Empty"
            : `${stats.reachable} of ${itemCount} shown to requesters`}
        </span>
        {usageKnown && (
          <span className="tabular text-ink-faint">
            {stats.raised === 0 ? "Not used yet" : `${stats.raised} raised · ${stats.recent} in 30 days`}
          </span>
        )}
      </motion.div>

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      <motion.div
        layoutScroll
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-line p-3 sm:p-4"
      >
        {items.length === 0 ? (
          <motion.div {...rise(startAt + 0.08)} className="flex flex-col items-center px-4 py-8 text-center">
            <span className="mb-3 flex size-10 items-center justify-center rounded-xl border border-line bg-surface text-ink-faint">
              <Icons.bolt className="size-4" />
            </span>
            <p className="text-[0.875rem] font-medium text-ink">No quick tickets in this group yet</p>
            <p className="mt-1 max-w-sm text-[0.8125rem] text-ink-muted text-pretty">
              Requesters won&apos;t see it until one is live. Add the problems people report about{" "}
              {group.name} most.
            </p>
          </motion.div>
        ) : (
          <ol ref={listRef} className="space-y-2">
            {items.map((item, index) => (
              <ItemTile
                key={item.id}
                item={item}
                position={index + 1}
                total={items.length}
                rule={ruleById.get(item.routing_rule_id) ?? null}
                groupLive={group.is_active}
                usage={usage[item.id] ?? null}
                busy={busy}
                act={act}
                // The pop-up's focus trap puts focus here as it opens; a returning list places it itself.
                first={index === 0 && entrance !== "back"}
                delay={reduced ? 0 : startAt + 0.06 + stagger(index, 0.035, 10)}
                reduced={reduced}
                onEdit={() => onEdit(item)}
                onMove={(delta) => onMove(item, delta)}
              />
            ))}
          </ol>
        )}
      </motion.div>

      <motion.div
        {...rise(reduced ? 0 : startAt + 0.12)}
        className={cn(
          "flex flex-none flex-col gap-2 border-t border-line px-5 py-3 sm:flex-row sm:items-center sm:justify-between",
          sheet && "pb-[max(0.75rem,env(safe-area-inset-bottom))]",
        )}
      >
        <Button
          size="sm"
          variant="secondary"
          data-return="add"
          data-autofocus={(items.length === 0 && entrance !== "back") || undefined}
          icon={<Icons.plus className="size-3.5" />}
          onClick={onAdd}
          className="self-start"
        >
          Add quick ticket
        </Button>
        <div className="sm:w-64">
          <Switch
            label={group.is_active ? "Group is live" : "Group is hidden"}
            hint={group.is_active ? "Shown to requesters" : "Hidden from requesters"}
            checked={group.is_active}
            disabled={toggling}
            onChange={(value) =>
              void act(
                `toggle-group-${group.id}`,
                () =>
                  api(`/api/admin/quick-tickets/groups/${group.id}`, {
                    method: "PATCH",
                    json: { is_active: value },
                  }),
                value ? "Group is live" : "Group hidden from requesters",
              )
            }
          />
        </div>
      </motion.div>
    </div>
  );
}

/** Live, hidden, or live but showing nothing — the one thing worth colour on a group. */
function GroupStatus({ group, reachable }: { group: QuickTicketGroup; reachable: number }) {
  if (!group.is_active) return <Badge tone="slate">Hidden</Badge>;
  if (reachable === 0) return <Badge tone="amber">Not shown — nothing live</Badge>;
  return (
    <Badge tone="emerald" emphasis="quiet">
      Live
    </Badge>
  );
}

function ItemTile({
  item,
  position,
  total,
  rule,
  groupLive,
  usage,
  busy,
  act,
  first,
  delay,
  reduced,
  onEdit,
  onMove,
}: {
  item: QuickTicket;
  position: number;
  total: number;
  rule: RuleOption | null;
  groupLive: boolean;
  usage: QuickUsage | null;
  busy: string | null;
  act: Act;
  first: boolean;
  delay: number;
  reduced: boolean;
  onEdit: () => void;
  onMove: (delta: -1 | 1) => void;
}) {
  const startsAt: TicketPriority = effectivePriority(item.priority, rule?.default_priority);
  const meta = PRIORITY_META[startsAt];

  return (
    <motion.li
      layout="position"
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        opacity: { duration: 0.22, ease: ease.standard, delay },
        y: { ...spring.gentle, delay },
        layout: spring.gentle,
      }}
      className="min-w-0"
    >
      <div
        className={cn(
          // `quick-tile` takes the pointer light.
          "quick-tile relative rounded-[12px] border border-line bg-surface p-3 pl-3.5",
          "transition-[border-color,box-shadow] duration-200 ease-[var(--ease-standard)] hover:border-line-strong hover:shadow-[var(--shadow-sm)]",
          !item.is_active && "bg-surface/60",
        )}
      >
        <span aria-hidden className="spot-wash" />
        <span aria-hidden className="spot-ring" />
        <div className="relative flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
          <div className="flex min-w-0 flex-1 gap-3">
            <span className="readout mt-0.5 w-5 flex-none text-[0.6875rem] text-ink-faint">
              {String(position).padStart(2, "0")}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <button
                  type="button"
                  onClick={onEdit}
                  data-autofocus={first || undefined}
                  className={cn(
                    "min-w-0 break-words text-left text-[0.875rem] font-medium underline-offset-4 hover:underline",
                    item.is_active ? "text-ink" : "text-ink-muted",
                  )}
                >
                  {item.label}
                </button>
                {!item.is_active && <Badge tone="slate">Hidden</Badge>}
                {item.is_active && rule && !rule.is_active && (
                  <Badge tone="amber">Category hidden — not shown</Badge>
                )}
              </div>
              <p className="mt-0.5 break-words text-[0.75rem] text-ink-faint">{item.subject}</p>
              <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.6875rem] text-ink-muted">
                <span>{rule?.category ?? "Unknown category"}</span>
                <span data-tone={meta.tone} className="inline-flex items-center gap-1.5">
                  <span className="tone-dot" />
                  {meta.label}
                  {startsAt !== item.priority && <span className="text-ink-faint">(category default)</span>}
                </span>
                {item.detail_prompt && (
                  <span className="min-w-0 break-words">
                    Asks &ldquo;{item.detail_prompt}&rdquo;{item.detail_required ? " · required" : ""}
                  </span>
                )}
                <span className="tabular">
                  {usage && usage.total > 0 ? (
                    <>
                      {usage.total} raised · {usage.recent} in 30 days
                      {usage.lastUsedAt && (
                        <>
                          {" "}· last <TimeAgo value={usage.lastUsedAt} />
                        </>
                      )}
                    </>
                  ) : (
                    "Not used yet"
                  )}
                </span>
              </p>
            </div>
          </div>

          <div className="flex flex-none items-center gap-1 pl-8 sm:pl-0">
            <MoveButton label={`Move ${item.label} up`} disabled={position === 1} onClick={() => onMove(-1)}>
              <Icons.chevronUp className="size-4" />
            </MoveButton>
            <MoveButton label={`Move ${item.label} down`} disabled={position === total} onClick={() => onMove(1)}>
              <Icons.chevronDown className="size-4" />
            </MoveButton>
            <div className="w-28 px-1">
              <Switch
                label={item.is_active ? "Live" : "Hidden"}
                checked={item.is_active}
                disabled={busy === `toggle-${item.id}`}
                onChange={(value) =>
                  void act(
                    `toggle-${item.id}`,
                    () => api(`/api/admin/quick-tickets/${item.id}`, { method: "PATCH", json: { is_active: value } }),
                    !value
                      ? "Hidden from requesters"
                      : rule && !rule.is_active
                        ? "Live, but requesters won't see it until its category is"
                        : !groupLive
                          ? "Live, but requesters won't see it until its group is"
                          : "Quick ticket is live",
                  )
                }
              />
            </div>
            <Button size="sm" variant="secondary" data-return={`item:${item.id}`} onClick={onEdit}>
              Edit
            </Button>
          </div>
        </div>
      </div>
    </motion.li>
  );
}

/**
 * aria-disabled rather than disabled: moving to the top would otherwise
 * disable the very button holding focus, and the browser drops focus to the
 * page — a keyboard user would lose their place after every boundary move.
 */
function MoveButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-disabled={disabled}
      onClick={() => {
        if (!disabled) onClick();
      }}
      className={cn(
        "tap-safe flex size-7 items-center justify-center rounded-lg text-ink-faint",
        "transition-colors duration-150",
        disabled ? "cursor-default opacity-35" : "hover:bg-surface-hover hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

// ----------------------------------------------------------- details --

type Details = { name: string; description: string; icon: QuickTicketIcon };

const detailsOf = (group: QuickTicketGroup): Details => ({
  name: group.name,
  description: group.description ?? "",
  icon: isQuickIcon(group.icon) ? group.icon : "bolt",
});

/** What the server would store: trimmed, a blank description as none. */
const normalizedDetails = (details: Details) => ({
  name: details.name.trim(),
  description: details.description.trim() || null,
  icon: details.icon,
});

const sameDetails = (a: Details, b: Details) => {
  const x = normalizedDetails(a);
  const y = normalizedDetails(b);
  return x.name === y.name && x.description === y.description && x.icon === y.icon;
};

/**
 * The group itself: its name, description and icon — everything a requester
 * reads on its card, previewed as they will see it — and deleting it.
 *
 * Groups carry no revision, so a save is the last word; but a change saved
 * elsewhere while this is open is taken in when nothing here is unsaved, and
 * flagged when something is, the same as the quick-ticket editor.
 */
function GroupDetails({
  group,
  items,
  shown,
  stats,
  usageKnown,
  armDelete,
  onBack,
  onClose,
  onDone,
  onDeleted,
  onGone,
  registerGuard,
  containerRef,
  titleId,
  hintId,
  sheet,
  onHeaderPointerDown,
  className,
  style,
}: {
  group: QuickTicketGroup;
  items: QuickTicket[];
  /** What its card lists, were it live. */
  shown: QuickTicket[];
  stats: ReturnType<typeof groupStats>;
  usageKnown: boolean;
  /** Opened to delete it: the confirmation is already showing. */
  armDelete: boolean;
  onBack: () => void;
  onClose: () => void;
  /** Saved: back to the list without asking. */
  onDone: () => void;
  onDeleted: () => void;
  /** It was deleted elsewhere: close without asking. */
  onGone: () => void;
  registerGuard: RegisterGuard;
  containerRef: React.RefObject<HTMLElement | null>;
  titleId: string;
  hintId: string;
  sheet: boolean;
  onHeaderPointerDown?: (event: React.PointerEvent) => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  const router = useRouter();
  const { push } = useToast();
  const id = useId();
  const rootRef = useRef<HTMLFormElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const finePointer = useMediaQuery("(pointer: fine)");
  const present = useIsPresent();

  const canDelete = stats.raised === 0 && usageKnown;
  const [form, setForm] = useState<Details>(() => detailsOf(group));
  const [base, setBase] = useState<Details>(form);
  const [seen, setSeen] = useState<Details>(form);
  const [conflict, setConflict] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(armDelete && canDelete);
  const [pendingExit, setPendingExit] = useState<{ kind: "back" | "close"; proceed: () => void } | null>(null);

  const dirty = !sameDetails(form, base);

  // Changed from elsewhere — another admin, another tab. Groups have no
  // revision; this compares what they say.
  const server = detailsOf(group);
  if (!sameDetails(server, seen)) {
    setSeen(server);
    if (!dirty) {
      setForm(server);
      setBase(server);
      setConflict(false);
    } else {
      setConflict(true);
    }
  }
  // Something was raised from it since the confirmation opened: it can no
  // longer be deleted, so stop offering to.
  if (confirmDelete && !canDelete) setConfirmDelete(false);

  useEffect(() => {
    if (!present) return;
    return registerGuard((proceed, kind) => {
      if (saving || deleting) return;
      // Asked again the same way, it goes; asked another way, it asks about that.
      if (dirty && pendingExit?.kind !== kind) {
        setPendingExit({ kind, proceed });
        return;
      }
      proceed();
    });
  }, [present, registerGuard, saving, deleting, dirty, pendingExit]);

  // The name, when the server refused it, once saving is over: the fieldset
  // is disabled while it runs, and a disabled field takes no focus.
  const refocusName = useRef(false);
  useEffect(() => {
    if (saving || !refocusName.current) return;
    refocusName.current = false;
    nameRef.current?.focus();
  }, [saving]);

  // Arriving from the list — opening straight here, the pop-up's own focus
  // trap does the same.
  useEffect(() => {
    const target = rootRef.current?.querySelector<HTMLElement>("[data-autofocus]") ?? containerRef.current;
    target?.focus({ preventScroll: true });
  }, [containerRef]);

  function set<K extends keyof Details>(field: K, value: Details[K]) {
    setForm((f) => ({ ...f, [field]: value }));
    if (field === "name") setNameError(null);
    setPendingExit(null);
    setFailure(null);
  }

  function loadTheirs() {
    setForm(server);
    setBase(server);
    setSeen(server);
    setConflict(false);
    setNameError(null);
    setFailure(null);
    setPendingExit(null);
  }

  function handleError(error: unknown) {
    if (!(error instanceof ApiClientError)) {
      setFailure("Couldn't reach the server. Check your connection — nothing was changed.");
      return;
    }
    if (error.status === 404) {
      push({ tone: "error", title: "That's gone", description: error.message });
      router.refresh();
      onGone();
      return;
    }
    const details = error.details;
    const field =
      details && typeof details === "object" && !Array.isArray(details)
        ? (details as Record<string, unknown>).field
        : Array.isArray(details)
          ? (details as { path?: unknown[] }[])[0]?.path?.[0]
          : undefined;
    if (field === "name") {
      setNameError(error.message);
      refocusName.current = true;
      return;
    }
    setFailure(error.message);
  }

  async function save() {
    if (saving || deleting) return;
    const next = normalizedDetails(form);
    if (!next.name) {
      setNameError("Give the group a name.");
      nameRef.current?.focus();
      return;
    }
    const was = normalizedDetails(base);
    // Only what changed here, so a field someone else changed meanwhile is
    // not written back over them.
    const changes = Object.fromEntries(
      (Object.keys(next) as (keyof typeof next)[])
        .filter((key) => next[key] !== was[key])
        .map((key) => [key, next[key]]),
    );
    if (Object.keys(changes).length === 0) {
      onDone();
      return;
    }

    setSaving(true);
    setFailure(null);
    setPendingExit(null);
    try {
      await api(`/api/admin/quick-tickets/groups/${group.id}`, { method: "PATCH", json: changes });
      push({ tone: "success", title: "Group updated" });
      // The new baseline, so the refresh carrying it is taken in quietly.
      setBase(form);
      setSeen({ ...form, name: next.name, description: next.description ?? "" });
      router.refresh();
      onDone();
    } catch (error) {
      handleError(error);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (saving || deleting) return;
    setDeleting(true);
    setFailure(null);
    setPendingExit(null);
    try {
      await api(`/api/admin/quick-tickets/groups/${group.id}`, { method: "DELETE" });
      push({ tone: "success", title: "Group deleted" });
      onDeleted();
    } catch (error) {
      setConfirmDelete(false);
      handleError(error);
    } finally {
      setDeleting(false);
    }
  }

  const nameId = `${id}-name`;
  const descriptionId = `${id}-description`;
  const locked = saving || deleting;

  return (
    <form
      ref={rootRef}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      style={style}
      className={cn("flex min-h-0 flex-col", className)}
    >
      {/* ------------------------------------------------------ header -- */}
      <div
        onPointerDown={onHeaderPointerDown}
        className={cn(
          "flex flex-none items-start gap-3 px-5 pb-4",
          sheet ? "pt-1" : "pt-4",
          onHeaderPointerDown && "touch-none",
        )}
      >
        <button
          type="button"
          onClick={onBack}
          aria-label={`Back to ${group.name}`}
          title={`Back to ${group.name}`}
          className="tap-safe -ml-1.5 mt-0.5 flex size-9 flex-none items-center justify-center rounded-[10px] text-ink-faint transition-colors hover:bg-surface-hover hover:text-ink"
        >
          <Icons.arrowLeft className="size-4" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="eyebrow truncate">Group · {group.name}</p>
          <h2
            id={titleId}
            className="mt-1.5 break-words text-[1.0625rem] font-semibold leading-snug tracking-tight text-ink"
          >
            {confirmDelete ? `Delete “${group.name}”?` : "Name, description and icon"}
          </h2>
          <p id={hintId} className="mt-0.5 text-[0.8125rem] text-ink-muted text-pretty">
            {confirmDelete
              ? items.length > 0
                ? `${items.length === 1 ? "Its quick ticket goes" : `Its ${items.length} quick tickets go`} with it. None has raised a ticket.`
                : "There's nothing in it, and nothing has been raised from it."
              : "Requesters see these on the group's card on the Quick tickets page."}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="tap-safe -mr-1.5 flex size-8 flex-none items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-surface-hover hover:text-ink"
        >
          <Icons.close className="size-4" />
        </button>
      </div>

      {/* -------------------------------------------------------- body -- */}
      <div className="@container min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-line px-5 py-4">
        <AnimatePresence initial={false}>
          {conflict && (
            <Banner key="conflict" tone="amber">
              Someone else changed this group while you were editing.{" "}
              <button type="button" onClick={loadTheirs} className="font-medium underline underline-offset-2">
                Load their version
              </button>{" "}
              — it replaces your unsaved changes.
            </Banner>
          )}
        </AnimatePresence>

        <div className="grid gap-5 @2xl:grid-cols-[minmax(0,1fr)_17rem]">
          <fieldset disabled={locked} className="min-w-0 space-y-4">
            <Field label="Name" htmlFor={nameId} required error={nameError}>
              <Input
                ref={nameRef}
                id={nameId}
                value={form.name}
                maxLength={QUICK_TICKET_LIMITS.groupNameMax}
                placeholder="Printer"
                aria-invalid={nameError ? true : undefined}
                aria-describedby={`${nameId}-message`}
                data-autofocus={(finePointer && !confirmDelete) || undefined}
                onChange={(e) => set("name", e.target.value)}
              />
            </Field>
            <Field
              label="Short description"
              htmlFor={descriptionId}
              hint={`Optional — without one, the card lists its quick tickets. ${charCount(form.description)}/${QUICK_TICKET_LIMITS.groupDescriptionMax}`}
            >
              <Input
                id={descriptionId}
                value={form.description}
                maxLength={QUICK_TICKET_LIMITS.groupDescriptionMax}
                placeholder="Jams, toner, scanning and printing"
                aria-describedby={`${descriptionId}-message`}
                onChange={(e) => set("description", e.target.value)}
              />
            </Field>
            <div className="space-y-1.5">
              <p id={`${id}-icon`} className="text-[0.8125rem] font-medium text-ink-muted">
                Icon
              </p>
              <IconPicker labelledBy={`${id}-icon`} value={form.icon} onChange={(icon) => set("icon", icon)} />
            </div>
          </fieldset>

          <CardPreview details={form} live={group.is_active} shown={shown} />
        </div>
      </div>

      {/* ------------------------------------------------------ footer -- */}
      <div
        className={cn(
          "flex-none border-t border-line px-5 py-3",
          sheet && "pb-[max(0.75rem,env(safe-area-inset-bottom))]",
        )}
      >
        <AnimatePresence initial={false}>
          {failure && (
            <Banner key="failure" tone="rose">
              {failure}
            </Banner>
          )}
          {pendingExit && (
            <Banner key="discard" tone="amber">
              You have unsaved changes. {pendingExit.kind === "close" ? "Close" : "Go back"} anyway and lose
              them?{" "}
              <button type="button" onClick={pendingExit.proceed} className="font-medium underline underline-offset-2">
                Discard changes
              </button>
            </Banner>
          )}
        </AnimatePresence>

        {confirmDelete ? (
          <div
            role="alertdialog"
            aria-labelledby={`${id}-delete`}
            data-tone="rose"
            className="flex flex-wrap items-center gap-3 rounded-[12px] border border-[var(--tone-bd)] bg-[var(--tone-bg)] px-3.5 py-2.5"
          >
            <p id={`${id}-delete`} className="min-w-0 flex-1 basis-56 text-[0.8125rem] text-[var(--tone-fg)]">
              Delete &ldquo;{group.name}&rdquo;
              {items.length > 0 ? ` and its ${plural(items.length, "quick ticket")}` : ""}? This can&apos;t be
              undone.
            </p>
            <div className="ml-auto flex flex-none gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                data-autofocus=""
                autoFocus={!armDelete}
                disabled={deleting}
                onClick={() => setConfirmDelete(false)}
              >
                Keep it
              </Button>
              <Button type="button" size="sm" variant="danger" loading={deleting} onClick={() => void remove()}>
                Delete group
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span
              title={
                stats.raised > 0
                  ? "Tickets were raised from it — hide it instead."
                  : !usageKnown
                    ? "Usage couldn't be loaded, so deleting is off for now."
                    : undefined
              }
            >
              <Button
                type="button"
                variant="ghost"
                disabled={!canDelete || locked}
                onClick={() => {
                  setPendingExit(null);
                  setConfirmDelete(true);
                }}
                className="text-[#e11d48] dark:text-[#fb7185]"
              >
                Delete group
              </Button>
            </span>
            {!canDelete && (
              <span className="min-w-0 flex-1 basis-40 text-[0.75rem] text-ink-faint">
                {stats.raised > 0
                  ? `${plural(stats.raised, "ticket")} ${stats.raised === 1 ? "was" : "were"} raised from it — hide it instead of deleting.`
                  : "Usage couldn't be loaded, so deleting is off for now."}
              </span>
            )}
            <div className="ml-auto flex items-center gap-2">
              <Button type="button" variant="ghost" onClick={onBack} disabled={locked}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" loading={saving} disabled={deleting || !dirty}>
                Save changes
              </Button>
            </div>
          </div>
        )}
      </div>
    </form>
  );
}

/** The group's card as requesters will see it, with what is typed so far. */
function CardPreview({
  details,
  live,
  shown,
}: {
  details: Details;
  /** The group is switched on. */
  live: boolean;
  /** The quick tickets its card would list. */
  shown: QuickTicket[];
}) {
  const name = details.name.trim();
  const description = details.description.trim();
  // As on the requester's card: with no description, the quick tickets say what it is for.
  const summary = description || shown.map((item) => item.label).join(" · ");

  return (
    <aside aria-label="Preview" className="min-w-0 space-y-1.5 @2xl:sticky @2xl:top-0 @2xl:self-start">
      <p className="eyebrow">Requesters see</p>
      <div className="glyph-host relative flex min-h-[9.5rem] flex-col rounded-[14px] border border-line bg-surface p-4 shadow-[var(--shadow-sm)]">
        <span className="flex items-start justify-between gap-3">
          <span className="flex size-10 flex-none items-center justify-center rounded-[11px] border border-line bg-surface-sunk text-ink-muted">
            <QuickIcon name={details.icon} className="size-[1.15rem]" />
          </span>
          <span className="flex size-7 flex-none items-center justify-center rounded-full border border-line text-ink-faint">
            <Icons.arrowRight className="size-3.5 -rotate-45" />
          </span>
        </span>
        <span className="mt-3 block min-w-0">
          <span
            className={cn(
              "line-clamp-2 break-words text-[0.875rem] font-semibold leading-snug tracking-tight",
              name ? "text-ink" : "italic text-ink-faint",
            )}
          >
            {name || "Group name"}
          </span>
          <span className="mt-1 line-clamp-2 break-words text-xs leading-relaxed text-ink-faint">
            {summary || "Its quick tickets are listed here until it has a description."}
          </span>
        </span>
        <span className="mt-auto pt-3 text-[0.6875rem] text-ink-muted">
          <span className="readout font-medium text-ink">{shown.length}</span>{" "}
          {shown.length === 1 ? "quick ticket" : "quick tickets"}
        </span>
      </div>
      {(!live || shown.length === 0) && (
        <p className="text-[0.6875rem] leading-relaxed text-ink-faint">
          {shown.length === 0
            ? "Nothing in it is live, so requesters don't see this card yet."
            : "The group is hidden, so requesters don't see this card yet."}
        </p>
      )}
    </aside>
  );
}

function IconPicker({
  labelledBy,
  value,
  onChange,
}: {
  labelledBy: string;
  value: string;
  onChange: (icon: QuickTicketIcon) => void;
}) {
  const current = isQuickIcon(value) ? value : "bolt";

  function onKey(event: React.KeyboardEvent, index: number) {
    const count = QUICK_TICKET_ICONS.length;
    let next = -1;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % count;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + count) % count;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = count - 1;
    if (next < 0) return;
    event.preventDefault();
    onChange(QUICK_TICKET_ICONS[next]);
    (event.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus();
  }

  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className="flex flex-wrap gap-1.5">
      {QUICK_TICKET_ICONS.map((icon, index) => {
        const active = icon === current;
        return (
          <button
            key={icon}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={QUICK_ICON_LABEL[icon]}
            title={QUICK_ICON_LABEL[icon]}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(icon)}
            onKeyDown={(event) => onKey(event, index)}
            className={cn(
              "glyph-host flex size-11 items-center justify-center rounded-[10px] border transition-colors duration-150 sm:size-9",
              active
                ? "border-accent-line bg-accent-soft text-accent"
                : "border-line bg-surface text-ink-faint hover:border-line-strong hover:text-ink",
            )}
          >
            <QuickIcon name={icon} className="size-4" />
          </button>
        );
      })}
    </div>
  );
}
