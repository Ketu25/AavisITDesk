"use client";

import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Switch } from "@/components/ui/field";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { EmptyState } from "@/components/ui/states";
import { TimeAgo } from "@/components/ui/time-ago";
import { useToast } from "@/components/ui/toast";
import { Icons } from "@/components/shell/icons";
import { QuickIcon } from "@/components/quick-tickets";
import { StaggerChildren } from "@/components/motion";
import { api, ApiClientError } from "@/lib/api";
import {
  PRIORITY_META,
  QUICK_ICON_LABEL,
  QUICK_TICKET_ICONS,
  QUICK_TICKET_LIMITS,
  type QuickTicketIcon,
} from "@/lib/constants";
import { effectivePriority, guessIcon, isQuickIcon } from "@/lib/quick-tickets";
import { transition } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { QuickTicket, QuickTicketGroup, TicketPriority } from "@/lib/database.types";
import type { EditorRequest, EditorSession, RuleOption } from "./quick-ticket-editor";

// Opened by a click, never part of the server render: kept out of the Worker
// bundle and fetched the first time an admin adds or edits one.
const QuickTicketEditor = dynamic(
  () => import("./quick-ticket-editor").then((m) => m.QuickTicketEditor),
  { ssr: false, loading: () => null },
);

export type QuickUsage = { total: number; recent: number; lastUsedAt: string | null };

type Act = (key: string, run: () => Promise<unknown>, success: string) => Promise<boolean>;

function sameOrder(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/**
 * An order the admin changes with the arrows, saved as a whole list.
 *
 * A move shows at once and stays until the server's order catches up — the
 * page also refreshes for unrelated reasons, and snapping back to a stale
 * order mid-save would look like the move was lost. Saves are serialised and
 * always send the newest order, so quick successive moves cannot land out of
 * sequence. If the server's order changes underneath while nothing is being
 * saved (another admin), the server wins. The same rules as the routing list.
 */
function useSavedOrder(serverIds: string[], serverKey: string, save: (ids: string[]) => Promise<unknown>) {
  const router = useRouter();
  const { push } = useToast();
  const [draft, setDraft] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [settledKey, setSettledKey] = useState<string | null>(null);
  const inFlight = useRef(false);
  const queued = useRef<string[] | null>(null);

  const known = new Set(serverIds);
  const orderIds = draft
    ? [...draft.filter((id) => known.has(id)), ...serverIds.filter((id) => !draft.includes(id))]
    : serverIds;

  if (draft && !saving) {
    if (sameOrder(draft, serverIds)) {
      setDraft(null);
      setSettledKey(null);
    } else if (settledKey === null) {
      setSettledKey(serverKey);
    } else if (settledKey !== serverKey) {
      setDraft(null);
      setSettledKey(null);
    }
  }

  async function persist(ids: string[]) {
    setSettledKey(null);
    queued.current = ids;
    if (inFlight.current) return;

    inFlight.current = true;
    setSaving(true);
    try {
      while (queued.current) {
        const next = queued.current;
        queued.current = null;
        await save(next);
      }
      push({ tone: "success", title: "Order saved" });
    } catch (error) {
      queued.current = null;
      setDraft(null);
      push({
        tone: "error",
        title: "The new order wasn't saved",
        description: error instanceof ApiClientError ? error.message : "Please try again.",
      });
    } finally {
      inFlight.current = false;
      setSaving(false);
      router.refresh();
    }
  }

  function move(id: string, delta: -1 | 1) {
    const ids = [...orderIds];
    const from = ids.indexOf(id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return null;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    setDraft(ids);
    void persist(ids);
    return ids;
  }

  return { orderIds, move };
}

export function QuickTicketsAdmin({
  groups,
  items,
  rules,
  usage,
  usageKnown,
  failed,
}: {
  groups: QuickTicketGroup[];
  items: QuickTicket[];
  rules: RuleOption[];
  usage: Record<string, QuickUsage>;
  usageKnown: boolean;
  failed: boolean;
}) {
  const router = useRouter();
  const { push } = useToast();

  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [editor, setEditor] = useState<EditorSession | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const editorKey = useRef(0);

  const byId = new Map(groups.map((group) => [group.id, group]));
  const groupOrder = useSavedOrder(
    groups.map((group) => group.id),
    groups.map((group) => `${group.id}:${group.sort_order}`).join("|"),
    (ids) => api("/api/admin/quick-tickets/groups/order", { method: "PUT", json: { ids } }),
  );
  const orderedGroups = groupOrder.orderIds.map((id) => byId.get(id)!).filter(Boolean);

  const ruleById = new Map(rules.map((rule) => [rule.id, rule]));
  const itemsByGroup = new Map<string, QuickTicket[]>();
  for (const item of items) {
    const list = itemsByGroup.get(item.group_id) ?? [];
    list.push(item);
    itemsByGroup.set(item.group_id, list);
  }

  const act: Act = async (key, run, success) => {
    setBusy(key);
    try {
      await run();
      push({ tone: "success", title: success });
      router.refresh();
      return true;
    } catch (error) {
      push({
        tone: "error",
        title: "That didn't work",
        description: error instanceof ApiClientError ? error.message : "Please try again.",
      });
      // A 404 or a stale reference means the page is behind; catch it up.
      if (error instanceof ApiClientError && (error.status === 404 || error.status === 422)) {
        router.refresh();
      }
      return false;
    } finally {
      setBusy(null);
    }
  };

  function openEditor(session: EditorRequest) {
    setEditor({ ...session, key: ++editorKey.current });
    setEditorOpen(true);
  }

  const guessed = guessIcon(newName);

  if (failed) {
    return (
      <div className="card flex flex-col items-center gap-3 px-4 py-10 text-center">
        <Icons.alert className="size-5 text-ink-faint" />
        <div>
          <p className="text-[0.875rem] font-medium text-ink">Couldn&apos;t load the quick tickets</p>
          <p className="mt-1 text-[0.8125rem] text-ink-muted">
            Nothing has changed. Check your connection, then try again.
          </p>
        </div>
        <Button size="sm" variant="secondary" icon={<Icons.refresh className="size-3.5" />} onClick={() => router.refresh()}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <StaggerChildren className="space-y-4">
      <div className="card p-4">
        <p className="text-[0.8125rem] leading-relaxed text-ink-muted">
          Requesters see live groups on the{" "}
          <Link href="/quick-tickets" className="text-accent underline-offset-4 hover:underline">
            Quick tickets
          </Link>{" "}
          page in the sidebar and in{" "}
          <kbd className="readout rounded border border-line bg-surface-sunk px-1 text-[0.6875rem]">⌘K</kbd>.
          Picking one shows them exactly what IT will receive — the title, details, category and
          urgency you write here — and they send it after a check. Nothing is sent on a single
          tap.
        </p>
        <p className="mt-2 text-[0.8125rem] leading-relaxed text-ink-muted">
          Give a quick ticket a question, like &ldquo;Which printer?&rdquo;, and the answer lands
          in the ticket&apos;s title so IT can tell the reports apart. Tickets route by their
          category, the same as any other — see{" "}
          <Link href="/admin/routing" className="text-accent underline-offset-4 hover:underline">
            Routing
          </Link>
          .
        </p>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          const name = newName.trim();
          if (!name) return;
          void act(
            "create-group",
            async () => {
              await api("/api/admin/quick-tickets/groups", { method: "POST", json: { name } });
              setNewName("");
            },
            "Group added at the bottom",
          );
        }}
        className="card flex gap-2 p-2.5"
      >
        <span
          aria-hidden
          title={`Icon: ${QUICK_ICON_LABEL[guessed]} — change it after adding`}
          className="hidden size-11 flex-none items-center justify-center rounded-[10px] border border-line bg-surface-sunk text-ink-muted sm:flex sm:size-9"
        >
          <QuickIcon name={guessed} className="size-4" />
        </span>
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          maxLength={QUICK_TICKET_LIMITS.groupNameMax}
          placeholder="Add a group — e.g. Printer, Shared drive, Email"
          aria-label="New group name"
          className="flex-1"
        />
        <Button
          type="submit"
          variant="primary"
          icon={<Icons.plus className="size-3.5" />}
          loading={busy === "create-group"}
          disabled={!newName.trim()}
        >
          Add
        </Button>
      </form>

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      {orderedGroups.length === 0 ? (
        <div className="card overflow-hidden">
          <EmptyState
            icon={<Icons.bolt />}
            title="No quick tickets yet"
            description="Add a group above — Printer, say — then the problems people report about it most."
          />
        </div>
      ) : (
        <div className="space-y-3">
          <AnimatePresence initial={false}>
            {orderedGroups.map((group, index) => (
              <GroupCard
                key={group.id}
                group={group}
                items={itemsByGroup.get(group.id) ?? []}
                position={index + 1}
                total={orderedGroups.length}
                ruleById={ruleById}
                usage={usage}
                usageKnown={usageKnown}
                busy={busy}
                act={act}
                onMove={(delta) => {
                  const ids = groupOrder.move(group.id, delta);
                  if (ids) {
                    setAnnouncement(`${group.name} moved to position ${ids.indexOf(group.id) + 1} of ${ids.length}.`);
                  }
                }}
                onAnnounce={setAnnouncement}
                onAdd={() => openEditor({ mode: "create", groupId: group.id })}
                onEdit={(item) => openEditor({ mode: "edit", id: item.id, groupId: item.group_id })}
              />
            ))}
          </AnimatePresence>
        </div>
      )}

      {editor && (
        <QuickTicketEditor
          key={editor.key}
          open={editorOpen}
          session={editor}
          // Read live, so another admin's change — or a delete — shows up in
          // an editor that is already open.
          item={editor.mode === "edit" ? items.find((item) => item.id === editor.id) ?? null : null}
          groups={orderedGroups}
          rules={rules}
          usage={editor.mode === "edit" ? (usage[editor.id] ?? null) : null}
          usageKnown={usageKnown}
          onClose={() => setEditorOpen(false)}
        />
      )}
    </StaggerChildren>
  );
}

// ------------------------------------------------------------------ group --

function GroupCard({
  group,
  items,
  position,
  total,
  ruleById,
  usage,
  usageKnown,
  busy,
  act,
  onMove,
  onAnnounce,
  onAdd,
  onEdit,
}: {
  group: QuickTicketGroup;
  items: QuickTicket[];
  position: number;
  total: number;
  ruleById: Map<string, RuleOption>;
  usage: Record<string, QuickUsage>;
  usageKnown: boolean;
  busy: string | null;
  act: Act;
  onMove: (delta: -1 | 1) => void;
  onAnnounce: (message: string) => void;
  onAdd: () => void;
  onEdit: (item: QuickTicket) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [draft, setDraft] = useState({ name: group.name, description: group.description ?? "", icon: group.icon });

  const byId = new Map(items.map((item) => [item.id, item]));
  const itemOrder = useSavedOrder(
    items.map((item) => item.id),
    items.map((item) => `${item.id}:${item.sort_order}`).join("|"),
    (ids) => api("/api/admin/quick-tickets/order", { method: "PUT", json: { group_id: group.id, ids } }),
  );
  const ordered = itemOrder.orderIds.map((id) => byId.get(id)!).filter(Boolean);

  // What a requester actually gets from this group: live quick tickets whose
  // category is live too.
  const reachable = group.is_active
    ? items.filter((item) => item.is_active && ruleById.get(item.routing_rule_id)?.is_active).length
    : 0;
  const raised = items.reduce((sum, item) => sum + (usage[item.id]?.total ?? 0), 0);
  const icon: QuickTicketIcon = isQuickIcon(group.icon) ? group.icon : "bolt";

  const menu: MenuItem[] = [
    {
      label: "Edit name and icon",
      onSelect: () => {
        setDraft({ name: group.name, description: group.description ?? "", icon });
        setConfirmDelete(false);
        setEditing(true);
      },
    },
    { separator: true },
    {
      label: "Delete group",
      danger: true,
      disabled: raised > 0 || !usageKnown || busy === `delete-group-${group.id}`,
      hint:
        raised > 0
          ? `${raised} ticket${raised === 1 ? " was" : "s were"} raised from it — hide it instead.`
          : !usageKnown
            ? "Usage couldn't be loaded, so deleting is off for now."
            : items.length > 0
              ? `Deletes it and its ${items.length} quick ticket${items.length === 1 ? "" : "s"}.`
              : "Nothing in it has been used.",
      onSelect: () => {
        setEditing(false);
        setConfirmDelete(true);
      },
    },
  ];

  async function saveGroup() {
    const name = draft.name.trim();
    if (!name) return;
    const ok = await act(
      `edit-group-${group.id}`,
      () =>
        api(`/api/admin/quick-tickets/groups/${group.id}`, {
          method: "PATCH",
          json: { name, description: draft.description.trim() || null, icon: draft.icon },
        }),
      "Group updated",
    );
    if (ok) setEditing(false);
  }

  return (
    <motion.section
      layout="position"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0 }}
      transition={transition.fast}
      aria-labelledby={`group-${group.id}`}
      className={cn("card overflow-hidden", !group.is_active && "opacity-[0.86]")}
    >
      {/* ------------------------------------------------------ header -- */}
      {editing ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void saveGroup();
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              setEditing(false);
            }
          }}
          className="space-y-3 p-4"
        >
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <Input
              value={draft.name}
              autoFocus
              maxLength={QUICK_TICKET_LIMITS.groupNameMax}
              aria-label="Group name"
              placeholder="Group name"
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            />
            <Input
              value={draft.description}
              maxLength={QUICK_TICKET_LIMITS.groupDescriptionMax}
              aria-label="Short description"
              placeholder="Short description (optional) — e.g. Jams, toner and scanning"
              onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
            />
          </div>
          <IconPicker value={draft.icon} onChange={(next) => setDraft((d) => ({ ...d, icon: next }))} />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              variant="primary"
              loading={busy === `edit-group-${group.id}`}
              disabled={!draft.name.trim()}
            >
              Save
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex items-start gap-3 p-4">
          <span className="flex size-9 flex-none items-center justify-center rounded-[10px] border border-line bg-surface text-ink-muted">
            <QuickIcon name={icon} className="size-[1.05rem]" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h3 id={`group-${group.id}`} className="min-w-0 break-words text-[0.9375rem] font-semibold tracking-tight text-ink">
                <span className="mr-1.5 tabular-nums text-ink-faint">{position}.</span>
                {group.name}
              </h3>
              {!group.is_active ? (
                <Badge tone="slate">Hidden</Badge>
              ) : reachable === 0 ? (
                <Badge tone="amber">Not shown — nothing live</Badge>
              ) : null}
            </div>
            <p className="mt-0.5 text-[0.75rem] text-ink-faint">
              {group.description ?? "No description"}
              <span aria-hidden> · </span>
              {items.length === 0
                ? "empty"
                : `${reachable} of ${items.length} shown to requesters`}
            </p>
          </div>
          <div className="flex flex-none items-center gap-0.5">
            <MoveButton label={`Move ${group.name} up`} disabled={position === 1} onClick={() => onMove(-1)}>
              <Icons.chevronUp className="size-4" />
            </MoveButton>
            <MoveButton label={`Move ${group.name} down`} disabled={position === total} onClick={() => onMove(1)}>
              <Icons.chevronDown className="size-4" />
            </MoveButton>
            <Menu items={menu} label={`Actions for ${group.name}`}>
              <Icons.more className="size-4" />
            </Menu>
          </div>
        </div>
      )}

      <AnimatePresence initial={false}>
        {confirmDelete && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={transition.fast}
            className="overflow-hidden"
          >
            <div
              role="alertdialog"
              aria-label={`Delete ${group.name}?`}
              data-tone="rose"
              className="mx-4 mb-3 flex flex-wrap items-center gap-3 rounded-[12px] border border-[var(--tone-bd)] bg-[var(--tone-bg)] px-3.5 py-2.5"
            >
              <p className="min-w-0 flex-1 text-[0.8125rem] text-[var(--tone-fg)]">
                Delete &ldquo;{group.name}&rdquo;
                {items.length > 0 ? ` and its ${items.length} quick ticket${items.length === 1 ? "" : "s"}` : ""}?
                This can&apos;t be undone.
              </p>
              <div className="flex flex-none gap-2">
                <Button size="sm" variant="ghost" autoFocus onClick={() => setConfirmDelete(false)}>
                  Keep it
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  loading={busy === `delete-group-${group.id}`}
                  onClick={async () => {
                    const ok = await act(
                      `delete-group-${group.id}`,
                      () => api(`/api/admin/quick-tickets/groups/${group.id}`, { method: "DELETE" }),
                      "Group deleted",
                    );
                    if (!ok) setConfirmDelete(false);
                  }}
                >
                  Delete group
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ------------------------------------------------------- items -- */}
      {ordered.length > 0 ? (
        <ol className="divide-y divide-line border-t border-line">
          {ordered.map((item, index) => (
            <ItemRow
              key={item.id}
              item={item}
              position={index + 1}
              total={ordered.length}
              rule={ruleById.get(item.routing_rule_id) ?? null}
              groupLive={group.is_active}
              usage={usage[item.id] ?? null}
              busy={busy}
              act={act}
              onEdit={() => onEdit(item)}
              onMove={(delta) => {
                const ids = itemOrder.move(item.id, delta);
                if (ids) onAnnounce(`${item.label} moved to position ${ids.indexOf(item.id) + 1} of ${ids.length}.`);
              }}
            />
          ))}
        </ol>
      ) : (
        <p className="border-t border-line px-4 py-5 text-center text-[0.8125rem] text-ink-faint">
          No quick tickets in this group yet. Requesters won&apos;t see it until one is live.
        </p>
      )}

      {/* ------------------------------------------------------ footer -- */}
      <div className="flex flex-col gap-2 border-t border-line px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <Button size="sm" variant="ghost" icon={<Icons.plus className="size-3.5" />} onClick={onAdd} className="-ml-2 self-start">
          Add quick ticket
        </Button>
        <div className="sm:w-64">
          <Switch
            label={group.is_active ? "Group is live" : "Group is hidden"}
            hint={group.is_active ? "Shown to requesters" : "Hidden from requesters"}
            checked={group.is_active}
            disabled={busy === `toggle-group-${group.id}`}
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
      </div>
    </motion.section>
  );
}

function IconPicker({ value, onChange }: { value: string; onChange: (icon: QuickTicketIcon) => void }) {
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
    <div role="radiogroup" aria-label="Icon" className="flex flex-wrap gap-1.5">
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
              "flex size-11 items-center justify-center rounded-[10px] border transition-colors duration-150 sm:size-9",
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

// ------------------------------------------------------------------- item --

function ItemRow({
  item,
  position,
  total,
  rule,
  groupLive,
  usage,
  busy,
  act,
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
  onEdit: () => void;
  onMove: (delta: -1 | 1) => void;
}) {
  const startsAt: TicketPriority = effectivePriority(item.priority, rule?.default_priority);
  const meta = PRIORITY_META[startsAt];

  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:gap-3">
      <div className="flex min-w-0 flex-1 gap-3">
        <span className="readout mt-0.5 w-5 flex-none text-[0.6875rem] text-ink-faint">
          {String(position).padStart(2, "0")}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <button
              type="button"
              onClick={onEdit}
              className="min-w-0 break-words text-left text-[0.8125rem] font-medium text-ink underline-offset-4 hover:underline"
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
        <Button size="sm" variant="secondary" onClick={onEdit}>
          Edit
        </Button>
      </div>
    </li>
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
