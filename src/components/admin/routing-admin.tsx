"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, Reorder, useDragControls } from "motion/react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Switch } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { Icons } from "@/components/shell/icons";
import { api, ApiClientError } from "@/lib/api";
import { PRIORITY_META } from "@/lib/constants";
import { TICKET_PRIORITIES, type RoutingRule } from "@/lib/database.types";
import { cn } from "@/lib/utils";
import { StaggerChildren } from "@/components/motion";

type Agent = { id: string; full_name: string };

function sameOrder(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

export function RoutingAdmin({
  rules,
  agents,
  autoAssignStrategy,
}: {
  rules: RoutingRule[];
  agents: Agent[];
  autoAssignStrategy: string;
}) {
  const router = useRouter();
  const { push } = useToast();

  const [newCategory, setNewCategory] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  // -- ordering -------------------------------------------------------------
  // `rules` arrives sorted by the server. A move shows at once as `draft` and
  // stays on screen until the server's order catches up with it — the page is
  // refreshed by unrelated ticket activity too, and snapping back to a stale
  // order mid-save would look like the move had been lost.
  const [draft, setDraft] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [settledKey, setSettledKey] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const inFlight = useRef(false);
  const queued = useRef<string[] | null>(null);
  const dragStartOrder = useRef<string[]>([]);
  const latestOrder = useRef<string[]>([]);

  const byId = new Map(rules.map((rule) => [rule.id, rule]));
  const serverIds = rules.map((rule) => rule.id);
  const serverKey = rules.map((rule) => `${rule.id}:${rule.sort_order}`).join("|");
  // Rules added or removed since the draft was taken still show: gone ones
  // drop out, new ones join at the bottom, where the server puts them.
  const orderIds = draft
    ? [
        ...draft.filter((id) => byId.has(id)),
        ...serverIds.filter((id) => !draft.includes(id)),
      ]
    : serverIds;
  const ordered = orderIds.map((id) => byId.get(id)!);
  const dragging = draggingId !== null && byId.has(draggingId);

  // Settle the draft once nothing is moving: drop it when the server agrees,
  // or when the server's order changed underneath it (another admin) — what
  // the database holds wins. The first idle render remembers what the server
  // looked like, so a refresh that has not landed yet is not mistaken for
  // disagreement.
  if (draft && !saving && !dragging) {
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

  // Saves are serialised: one request at a time, always sending the newest
  // order, so quick successive moves can never land out of sequence.
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
        await api("/api/admin/routing/order", { method: "PUT", json: { ids: next } });
      }
      push({ tone: "success", title: "Category order saved" });
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

  function announce(ids: string[], id: string) {
    const rule = byId.get(id);
    if (!rule) return;
    setAnnouncement(`${rule.category} moved to position ${ids.indexOf(id) + 1} of ${ids.length}.`);
  }

  function move(id: string, delta: -1 | 1) {
    const ids = [...orderIds];
    const from = ids.indexOf(id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    setDraft(ids);
    announce(ids, id);
    persist(ids);
  }

  async function act(key: string, run: () => Promise<unknown>, success: string) {
    setBusy(key);
    try {
      await run();
      push({ tone: "success", title: success });
      router.refresh();
    } catch (error) {
      push({
        tone: "error",
        title: "That didn't work",
        description: error instanceof ApiClientError ? error.message : "Please try again.",
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <StaggerChildren className="space-y-4">
      <div className="card p-4">
        <p className="text-[0.8125rem] leading-relaxed text-ink-muted">
          When a ticket is created the matching rule runs first: it can raise the priority and
          hand the ticket straight to a named agent. If no default owner is set, the queue-wide
          strategy takes over — currently{" "}
          <span className="font-medium text-ink">
            {autoAssignStrategy === "off"
              ? "manual assignment only"
              : autoAssignStrategy.replace("_", " ")}
          </span>
          .{" "}
          <Link
            href="/admin/settings"
            className="text-accent underline-offset-4 hover:underline"
          >
            Change that in Settings
          </Link>
          .
        </p>
        <p className="mt-2 text-[0.8125rem] leading-relaxed text-ink-muted">
          Requesters see the categories in the order below. Drag a card by its handle, or use
          the arrows, to change it. Hidden categories keep their place for when they go live
          again.
        </p>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!newCategory.trim()) return;
          act(
            "create",
            async () => {
              await api("/api/admin/routing", {
                method: "POST",
                json: { category: newCategory.trim() },
              });
              setNewCategory("");
            },
            "Category added at the bottom — move it where it belongs",
          );
        }}
        className="card flex gap-2 p-2.5"
      >
        <Input
          value={newCategory}
          onChange={(e) => setNewCategory(e.target.value)}
          placeholder="Add a category — e.g. Lab Instruments"
          className="flex-1"
        />
        <Button
          type="submit"
          variant="primary"
          icon={<Icons.plus className="size-3.5" />}
          loading={busy === "create"}
          disabled={!newCategory.trim()}
        >
          Add
        </Button>
      </form>

      <div>
        <p className="sr-only" aria-live="polite">
          {announcement}
        </p>
        <Reorder.Group
          as="div"
          axis="y"
          values={orderIds}
          onReorder={(ids: string[]) => {
            latestOrder.current = ids;
            setDraft(ids);
          }}
          className="space-y-2"
        >
          <AnimatePresence initial={false}>
            {ordered.map((rule, index) => (
              <RuleCard
                key={rule.id}
                rule={rule}
                position={index + 1}
                total={ordered.length}
                agents={agents}
                busy={busy}
                act={act}
                onMove={(delta) => move(rule.id, delta)}
                onDragStart={() => {
                  dragStartOrder.current = orderIds;
                  latestOrder.current = orderIds;
                  setDraggingId(rule.id);
                }}
                onDragEnd={() => {
                  setDraggingId(null);
                  const ids = latestOrder.current;
                  if (sameOrder(ids, dragStartOrder.current)) return;
                  announce(ids, rule.id);
                  persist(ids);
                }}
              />
            ))}
          </AnimatePresence>
        </Reorder.Group>
      </div>
    </StaggerChildren>
  );
}

function RuleCard({
  rule,
  position,
  total,
  agents,
  busy,
  act,
  onMove,
  onDragStart,
  onDragEnd,
}: {
  rule: RoutingRule;
  position: number;
  total: number;
  agents: Agent[];
  busy: string | null;
  act: (key: string, run: () => Promise<unknown>, success: string) => Promise<void>;
  onMove: (delta: -1 | 1) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  // The card is full of inputs and selects, so only the handle starts a drag —
  // otherwise selecting helper text or opening a dropdown would pick it up.
  const controls = useDragControls();
  const isFirst = position === 1;
  const isLast = position === total;

  return (
    <Reorder.Item
      as="div"
      value={rule.id}
      dragListener={false}
      dragControls={controls}
      layout="position"
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, height: 0 }}
      whileDrag={{ scale: 1.01, boxShadow: "var(--shadow-lg)" }}
      className="card relative p-4"
    >
      <div className="mb-3.5 flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <button
            type="button"
            aria-label={`Reorder ${rule.category}. Drag, or press the up and down arrow keys.`}
            title="Drag to reorder"
            onPointerDown={(event) => {
              event.preventDefault();
              controls.start(event);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowUp" && !isFirst) {
                event.preventDefault();
                onMove(-1);
              } else if (event.key === "ArrowDown" && !isLast) {
                event.preventDefault();
                onMove(1);
              }
            }}
            style={{ touchAction: "none" }}
            className={cn(
              "tap-safe -ml-1.5 mt-px flex size-7 flex-none cursor-grab items-center justify-center",
              "rounded-lg text-ink-faint transition-colors duration-150",
              "hover:bg-surface-hover hover:text-ink active:cursor-grabbing",
            )}
          >
            <Icons.grip className="size-4" />
          </button>
          <div className="min-w-0 pt-1">
            <p className="text-[0.875rem] font-medium text-ink">
              <span className="mr-1.5 tabular-nums text-ink-faint">{position}.</span>
              {rule.category}
            </p>
            {rule.description && (
              <p className="mt-0.5 text-[0.75rem] text-ink-faint">{rule.description}</p>
            )}
          </div>
        </div>
        <div className="flex flex-none items-center gap-3">
          <div className="flex items-center gap-0.5">
            <MoveButton
              label={`Move ${rule.category} up`}
              disabled={isFirst}
              onClick={() => onMove(-1)}
            >
              <Icons.chevronUp className="size-4" />
            </MoveButton>
            <MoveButton
              label={`Move ${rule.category} down`}
              disabled={isLast}
              onClick={() => onMove(1)}
            >
              <Icons.chevronDown className="size-4" />
            </MoveButton>
          </div>
          <div className="w-32">
            <Switch
              label={rule.is_active ? "Live" : "Hidden"}
              checked={rule.is_active}
              disabled={busy === `toggle-${rule.id}`}
              onChange={(value) =>
                act(
                  `toggle-${rule.id}`,
                  () =>
                    api(`/api/admin/routing/${rule.id}`, {
                      method: "PATCH",
                      json: { is_active: value },
                    }),
                  value ? "Category is live" : "Category hidden from new tickets",
                )
              }
            />
          </div>
          <Button
            size="sm"
            variant="danger"
            loading={busy === `delete-${rule.id}`}
            onClick={() =>
              act(
                `delete-${rule.id}`,
                () => api(`/api/admin/routing/${rule.id}`, { method: "DELETE" }),
                "Rule removed",
              )
            }
          >
            Remove
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Default owner" htmlFor={`agent-${rule.id}`}>
          <Select
            id={`agent-${rule.id}`}
            value={rule.default_assignee_id ?? ""}
            disabled={busy === `agent-${rule.id}`}
            onChange={(e) =>
              act(
                `agent-${rule.id}`,
                () =>
                  api(`/api/admin/routing/${rule.id}`, {
                    method: "PATCH",
                    json: { default_assignee_id: e.target.value || null },
                  }),
                "Default owner updated",
              )
            }
          >
            <option value="">Use queue strategy</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.full_name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Force priority" htmlFor={`priority-${rule.id}`}>
          <Select
            id={`priority-${rule.id}`}
            value={rule.default_priority ?? ""}
            disabled={busy === `priority-${rule.id}`}
            onChange={(e) =>
              act(
                `priority-${rule.id}`,
                () =>
                  api(`/api/admin/routing/${rule.id}`, {
                    method: "PATCH",
                    json: { default_priority: e.target.value || null },
                  }),
                "Default priority updated",
              )
            }
          >
            <option value="">Let the requester choose</option>
            {TICKET_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_META[p].label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Helper text" htmlFor={`desc-${rule.id}`}>
          <Input
            id={`desc-${rule.id}`}
            defaultValue={rule.description ?? ""}
            placeholder="Shown under the category"
            onBlur={(e) => {
              if (e.target.value === (rule.description ?? "")) return;
              act(
                `desc-${rule.id}`,
                () =>
                  api(`/api/admin/routing/${rule.id}`, {
                    method: "PATCH",
                    json: { description: e.target.value || null },
                  }),
                "Helper text updated",
              );
            }}
          />
        </Field>
      </div>
    </Reorder.Item>
  );
}

/**
 * aria-disabled rather than disabled: moving a card to the top would otherwise
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
