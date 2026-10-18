"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useIsPresent } from "motion/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Switch, Textarea } from "@/components/ui/field";
import { useMediaQuery } from "@/components/ui/use-media-query";
import { useToast } from "@/components/ui/toast";
import { Icons } from "@/components/shell/icons";
import { QuickIcon } from "@/components/quick-tickets/icon";
import { api, ApiClientError } from "@/lib/api";
import { PRIORITY_META, QUICK_TICKET_LIMITS, TICKET_LIMITS } from "@/lib/constants";
import { charCount, effectivePriority } from "@/lib/quick-tickets";
import { transition } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { QuickTicket, QuickTicketGroup, TicketPriority } from "@/lib/database.types";
import type { RegisterGuard, RuleOption } from "./quick-tickets-shared";

export type EditorRequest =
  | { mode: "create"; groupId: string }
  | { mode: "edit"; id: string; groupId: string };

type Form = {
  group_id: string;
  routing_rule_id: string;
  label: string;
  subject: string;
  description: string;
  priority: TicketPriority;
  detail_prompt: string;
  detail_required: boolean;
  is_active: boolean;
};
type FieldName = keyof Form;
type Errors = Partial<Record<FieldName, string>>;

/** Calm to critical, the order the requester-side meter reads in. */
const URGENCY: TicketPriority[] = ["low", "normal", "high", "urgent"];

/** Where focus goes to fix each field, top to bottom. */
const FIELD_ORDER: FieldName[] = [
  "group_id",
  "label",
  "routing_rule_id",
  "priority",
  "subject",
  "description",
  "detail_prompt",
  "detail_required",
];

function formFrom(item: QuickTicket): Form {
  return {
    group_id: item.group_id,
    routing_rule_id: item.routing_rule_id,
    label: item.label,
    subject: item.subject,
    description: item.description,
    priority: item.priority,
    detail_prompt: item.detail_prompt ?? "",
    detail_required: item.detail_required,
    is_active: item.is_active,
  };
}

function blankForm(groupId: string): Form {
  return {
    group_id: groupId,
    routing_rule_id: "",
    label: "",
    subject: "",
    description: "",
    priority: "normal",
    detail_prompt: "",
    detail_required: false,
    is_active: true,
  };
}

/** What the server would store: trimmed, blanks as null, no "required" without a question. */
function normalized(form: Form) {
  const prompt = form.detail_prompt.trim() || null;
  return {
    group_id: form.group_id,
    routing_rule_id: form.routing_rule_id,
    label: form.label.trim(),
    subject: form.subject.trim(),
    description: form.description.trim(),
    priority: form.priority,
    detail_prompt: prompt,
    detail_required: prompt !== null && form.detail_required,
    is_active: form.is_active,
  };
}

type Normalized = ReturnType<typeof normalized>;

function validate(form: Form): Errors {
  const n = normalized(form);
  const errors: Errors = {};
  if (!n.group_id) errors.group_id = "Pick a group.";
  if (!n.routing_rule_id) errors.routing_rule_id = "Pick the category it routes to.";
  if (charCount(n.label) < QUICK_TICKET_LIMITS.labelMin) {
    errors.label = n.label ? "Make the label a little longer." : "Give it a short label, like “Paper jam”.";
  }
  if (charCount(n.subject) < TICKET_LIMITS.subjectMin) {
    errors.subject = n.subject ? "Make the title a little longer." : "Give the ticket a title.";
  }
  if (charCount(n.description) < TICKET_LIMITS.descriptionMin) {
    errors.description = n.description
      ? "Add a little more detail."
      : "Describe the problem IT will be fixing.";
  }
  if (n.detail_prompt && charCount(n.detail_prompt) < QUICK_TICKET_LIMITS.promptMin) {
    errors.detail_prompt = "Make the question a little longer.";
  }
  return errors;
}

const sameValues = (a: Normalized, b: Normalized) =>
  (Object.keys(a) as (keyof Normalized)[]).every((key) => a[key] === b[key]);

/** Focus the control for `field` inside `root`, to fix it. */
function focusField(root: HTMLElement | null, field: FieldName) {
  const node = root?.querySelector<HTMLElement>(`[data-field="${field}"]`);
  // On a pointer screen a dropdown's native select is hidden under the
  // drawn trigger, which is what should take focus.
  const trigger =
    node instanceof HTMLSelectElement && node.getAttribute("aria-hidden") === "true"
      ? node.parentElement?.querySelector<HTMLElement>('[role="combobox"]')
      : null;
  (trigger ?? node)?.focus();
}

/**
 * Creating or editing one quick ticket, beside a preview of what requesters
 * will see and what IT will receive — a step inside its group's pop-up, which
 * slides back to the group's list once it is saved, deleted or left.
 *
 * An edit sends only the fields that changed, along with the revision the
 * editor opened; if another admin saved first, the server refuses and the
 * editor says so rather than overwriting them. Edits that arrive from
 * elsewhere while nothing has been typed are simply taken in.
 *
 * Leaving with unsaved changes — Back, Cancel, Escape, the close button, the
 * backdrop, or dragging the sheet away — asks first: the pop-up runs every
 * one of them past the guard this step puts in place.
 */
export function QuickTicketEditor({
  session,
  item,
  groups,
  rules,
  usage,
  usageKnown,
  onBack,
  onClose,
  onDone,
  registerGuard,
  containerRef,
  titleId,
  hintId,
  sheet,
  onHeaderPointerDown,
  className,
  style,
}: {
  session: EditorRequest;
  /** The quick ticket being edited, read live; null once deleted. */
  item: QuickTicket | null;
  groups: QuickTicketGroup[];
  rules: RuleOption[];
  usage: { total: number } | null;
  usageKnown: boolean;
  /** Back to the group's list, asking first if anything is unsaved. */
  onBack: () => void;
  /** Close the pop-up, asking first if anything is unsaved. */
  onClose: () => void;
  /** Saved, deleted, or found gone: back to the list without asking. */
  onDone: () => void;
  registerGuard: RegisterGuard;
  /** The pop-up, which takes focus when no field should. */
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
  const finePointer = useMediaQuery("(pointer: fine)");
  // False once the step is on its way out, so it neither grabs focus nor
  // stands guard over a list that has already come back.
  const present = useIsPresent();
  const editing = session.mode === "edit";

  const [form, setForm] = useState<Form>(() => (item ? formFrom(item) : blankForm(session.groupId)));
  const [base, setBase] = useState<Form>(form);
  const [seenRevision, setSeenRevision] = useState<number | null>(item?.revision ?? null);
  const [conflict, setConflict] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // A new quick ticket's title follows its label until someone writes one.
  const [subjectTouched, setSubjectTouched] = useState(editing);
  /** Leaving was asked for with changes unsaved; asking again, or Discard, goes through with it. */
  const [pendingExit, setPendingExit] = useState<{ kind: "back" | "close"; proceed: () => void } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const current = normalized(form);
  const dirty = !sameValues(current, normalized(base));
  const gone = editing && item === null;

  // Saved from elsewhere — another admin, another tab. Taken in when nothing
  // here is unsaved; flagged when something is, rather than dropping either.
  if (editing && item && item.revision !== seenRevision) {
    setSeenRevision(item.revision);
    if (!dirty) {
      const next = formFrom(item);
      setForm(next);
      setBase(next);
      setConflict(false);
    } else {
      setConflict(true);
    }
  }
  // Live/hidden carries no revision; follow it unless it was changed here.
  if (editing && item && item.is_active !== base.is_active) {
    setBase((b) => ({ ...b, is_active: item.is_active }));
    if (form.is_active === base.is_active) setForm((f) => ({ ...f, is_active: item.is_active }));
  }

  const rule = rules.find((r) => r.id === form.routing_rule_id) ?? null;
  const group = groups.find((g) => g.id === form.group_id) ?? null;
  const homeGroup = groups.find((g) => g.id === session.groupId) ?? group;
  const startsAt = effectivePriority(form.priority, rule?.default_priority);
  const lifted = startsAt !== form.priority;
  const hasPrompt = current.detail_prompt !== null;
  const used = (usage?.total ?? 0) > 0;

  // The guard the pop-up runs Back, Escape, the close button and the
  // backdrop past. Busy saving, nothing leaves; unsaved, the first try asks.
  useEffect(() => {
    if (!present) return;
    return registerGuard((proceed, kind) => {
      if (saving || deleting) return;
      // Asked again the same way, it goes; asked another way, it asks about that.
      if (dirty && !gone && pendingExit?.kind !== kind) {
        setPendingExit({ kind, proceed });
        return;
      }
      proceed();
    });
  }, [present, registerGuard, saving, deleting, dirty, gone, pendingExit]);

  // A field the server found fault with is focused once saving is over: the
  // fieldset is disabled while it runs, and a disabled field takes no focus.
  const refocus = useRef<FieldName | null>(null);
  useEffect(() => {
    if (saving || deleting || !refocus.current) return;
    focusField(rootRef.current, refocus.current);
    refocus.current = null;
  }, [saving, deleting]);

  // Arriving, focus goes to the first field of a new one — on a phone, not
  // a keyboard sliding up over the sheet as it arrives — or the pop-up itself.
  useEffect(() => {
    const target = rootRef.current?.querySelector<HTMLElement>("[data-autofocus]") ?? containerRef.current;
    target?.focus({ preventScroll: true });
  }, [containerRef]);

  function set<K extends FieldName>(field: K, value: Form[K]) {
    setForm((f) => {
      const next = { ...f, [field]: value };
      if (field === "label" && !subjectTouched) {
        const name = groups.find((g) => g.id === next.group_id)?.name;
        const label = String(value).trim();
        next.subject = label ? (name ? `${name}: ${label}` : label).slice(0, TICKET_LIMITS.subjectMax) : "";
      }
      if (field === "detail_prompt" && !String(value).trim()) next.detail_required = false;
      return next;
    });
    if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }));
    if (field === "label" && !subjectTouched && errors.subject) setErrors((e) => ({ ...e, subject: undefined }));
    setPendingExit(null);
  }

  function loadTheirs() {
    if (!item) return;
    const next = formFrom(item);
    setForm(next);
    setBase(next);
    setSeenRevision(item.revision);
    setConflict(false);
    setErrors({});
    setFailure(null);
    setPendingExit(null);
  }

  async function save() {
    if (saving || deleting || gone) return;
    const problems = validate(form);
    const first = FIELD_ORDER.find((field) => problems[field]);
    if (first) {
      setErrors(problems);
      focusField(rootRef.current, first);
      return;
    }

    setSaving(true);
    setFailure(null);
    setPendingExit(null);
    try {
      if (!editing) {
        await api("/api/admin/quick-tickets", { method: "POST", json: current });
        push({
          tone: "success",
          title: "Quick ticket added",
          description: current.is_active ? "Requesters can use it now." : "It's hidden until you switch it live.",
        });
      } else {
        const was = normalized(base);
        const changes = Object.fromEntries(
          (Object.keys(current) as (keyof Normalized)[])
            .filter((key) => current[key] !== was[key])
            .map((key) => [key, current[key]]),
        );
        if (Object.keys(changes).length === 0) {
          onDone();
          return;
        }
        const touchesContent = Object.keys(changes).some((key) => key !== "is_active");
        await api(`/api/admin/quick-tickets/${session.id}`, {
          method: "PATCH",
          json: touchesContent ? { ...changes, expected_revision: seenRevision } : changes,
        });
        push({
          tone: "success",
          title: "Quick ticket saved",
          // Saved into another group, it leaves this one's list: say where it went.
          description: "group_id" in changes && group ? `Moved to ${group.name}.` : undefined,
        });
      }
      // What was just saved is the new baseline, so the refresh carrying it
      // is taken in quietly rather than read as someone else's edit.
      setBase(form);
      router.refresh();
      onDone();
    } catch (error) {
      handleError(error);
    } finally {
      setSaving(false);
    }
  }

  function handleError(error: unknown) {
    if (!(error instanceof ApiClientError)) {
      setFailure("Couldn't reach the server. Check your connection — nothing was saved.");
      return;
    }
    const details = error.details;
    const reason =
      details && typeof details === "object" && !Array.isArray(details)
        ? (details as Record<string, unknown>)
        : {};

    if (reason.reason === "conflict") {
      setConflict(true);
      router.refresh();
      return;
    }
    if (error.status === 404) {
      push({ tone: "error", title: "That's gone", description: error.message });
      router.refresh();
      onDone();
      return;
    }
    // Zod's issues, one per field.
    if (Array.isArray(details)) {
      const next: Errors = {};
      for (const issue of details as { path?: unknown[]; message?: string }[]) {
        const field = issue.path?.[0];
        if (typeof field === "string" && field in form && !next[field as FieldName]) {
          next[field as FieldName] = issue.message ?? "Check this field.";
        }
      }
      setErrors(next);
      const first = FIELD_ORDER.find((field) => next[field]);
      if (first) refocus.current = first;
      setFailure(first ? null : error.message);
      return;
    }
    if (typeof reason.field === "string" && reason.field in form) {
      setErrors({ [reason.field]: error.message });
      refocus.current = reason.field as FieldName;
      return;
    }
    if (reason.reason === "reference") router.refresh();
    setFailure(error.message);
  }

  async function remove() {
    if (!editing || saving || deleting) return;
    setDeleting(true);
    setPendingExit(null);
    try {
      await api(`/api/admin/quick-tickets/${session.id}`, { method: "DELETE" });
      push({ tone: "success", title: "Quick ticket deleted" });
      setBase(form);
      router.refresh();
      onDone();
    } catch (error) {
      setConfirmDelete(false);
      handleError(error);
    } finally {
      setDeleting(false);
    }
  }

  const labelId = `${id}-label`;
  const groupId = `${id}-group`;
  const ruleId = `${id}-rule`;
  const priorityId = `${id}-priority`;
  const subjectId = `${id}-subject`;
  const descriptionId = `${id}-description`;
  const promptId = `${id}-prompt`;
  const groupName = homeGroup?.name ?? "Quick tickets";

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
          aria-label={`Back to ${groupName}`}
          title={`Back to ${groupName}`}
          className="tap-safe -ml-1.5 mt-0.5 flex size-9 flex-none items-center justify-center rounded-[10px] text-ink-faint transition-colors hover:bg-surface-hover hover:text-ink"
        >
          <Icons.arrowLeft className="size-4" />
        </button>
        <span className="glyph-host mt-0.5 hidden size-9 flex-none items-center justify-center rounded-[10px] border border-line bg-surface text-ink-muted sm:flex">
          <QuickIcon name={homeGroup?.icon ?? "bolt"} className="size-[1.05rem]" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="eyebrow truncate">
            {editing ? "Quick ticket" : "New quick ticket"} · {groupName}
          </p>
          <h2
            id={titleId}
            className="mt-1.5 break-words text-[1.0625rem] font-semibold leading-snug tracking-tight text-ink"
          >
            {editing ? `Edit “${item?.label ?? base.label}”` : "New quick ticket"}
          </h2>
          <p id={hintId} className="mt-0.5 text-[0.8125rem] text-ink-muted text-pretty">
            {editing
              ? "Changes apply to the next ticket raised with it. Tickets already sent keep what they said."
              : "Write it the way the requester would — they'll see exactly this before they send it."}
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
          {gone && (
            <Banner key="gone" tone="rose">
              Someone else deleted this quick ticket. There&apos;s nothing left to save.
            </Banner>
          )}
          {conflict && !gone && (
            <Banner key="conflict" tone="amber">
              Someone else saved this quick ticket while you were editing.{" "}
              <button type="button" onClick={loadTheirs} className="font-medium underline underline-offset-2">
                Load their version
              </button>{" "}
              — it replaces your unsaved changes.
            </Banner>
          )}
        </AnimatePresence>

        <div className="grid gap-5 @2xl:grid-cols-[minmax(0,1fr)_17rem]">
          {/* --------------------------------------------------- fields -- */}
          <fieldset disabled={saving || deleting || gone} className="min-w-0">
            <div className="@container space-y-4">
              <div className="grid gap-4 @sm:grid-cols-2">
                <Field label="Button label" htmlFor={labelId} required error={errors.label ?? null} hint="What requesters pick.">
                  <Input
                    id={labelId}
                    data-field="label"
                    data-autofocus={(!editing && finePointer) || undefined}
                    value={form.label}
                    maxLength={QUICK_TICKET_LIMITS.labelMax}
                    placeholder="Paper jam"
                    aria-invalid={errors.label ? true : undefined}
                    aria-describedby={`${labelId}-message`}
                    onChange={(e) => set("label", e.target.value)}
                  />
                </Field>
                <Field label="Group" htmlFor={groupId} required error={errors.group_id ?? null}>
                  <Select
                    id={groupId}
                    data-field="group_id"
                    value={form.group_id}
                    aria-invalid={errors.group_id ? true : undefined}
                    onChange={(e) => set("group_id", e.target.value)}
                  >
                    {!group && <option value="">Pick a group</option>}
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.is_active ? g.name : `${g.name} (hidden)`}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>

              <div className="grid gap-4 @sm:grid-cols-2">
                <Field
                  label="Category"
                  htmlFor={ruleId}
                  required
                  error={errors.routing_rule_id ?? null}
                  hint={rule && !rule.is_active ? "This category is hidden, so requesters won't see this quick ticket." : "Decides who it's routed to."}
                >
                  <Select
                    id={ruleId}
                    data-field="routing_rule_id"
                    value={form.routing_rule_id}
                    aria-invalid={errors.routing_rule_id ? true : undefined}
                    onChange={(e) => set("routing_rule_id", e.target.value)}
                  >
                    {!rule && <option value="">Pick a category</option>}
                    {rules.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.is_active ? r.category : `${r.category} (hidden)`}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field
                  label="Urgency"
                  htmlFor={priorityId}
                  hint={
                    lifted && rule
                      ? `${rule.category} starts at ${PRIORITY_META[startsAt].label}, so tickets open at ${PRIORITY_META[startsAt].label}.`
                      : "IT can still change it on the ticket."
                  }
                >
                  <Select
                    id={priorityId}
                    data-field="priority"
                    value={form.priority}
                    onChange={(e) => set("priority", e.target.value as TicketPriority)}
                  >
                    {URGENCY.map((p) => (
                      <option key={p} value={p}>
                        {PRIORITY_META[p].label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>

              <Field
                label="Ticket title"
                htmlFor={subjectId}
                required
                error={errors.subject ?? null}
                hint="What IT sees in the queue. The requester's answer is added to the end."
              >
                <Input
                  id={subjectId}
                  data-field="subject"
                  value={form.subject}
                  maxLength={TICKET_LIMITS.subjectMax}
                  placeholder="Printer: paper jam"
                  aria-invalid={errors.subject ? true : undefined}
                  aria-describedby={`${subjectId}-message`}
                  onChange={(e) => {
                    setSubjectTouched(true);
                    set("subject", e.target.value);
                  }}
                />
              </Field>

              <Field
                label="Details"
                htmlFor={descriptionId}
                required
                error={errors.description ?? null}
                hint={`In the requester's words. ${charCount(form.description)}/${QUICK_TICKET_LIMITS.descriptionMax}`}
              >
                <Textarea
                  id={descriptionId}
                  data-field="description"
                  rows={4}
                  value={form.description}
                  maxLength={QUICK_TICKET_LIMITS.descriptionMax}
                  placeholder="Paper is stuck in the printer and it won't print until the jam is cleared."
                  aria-invalid={errors.description ? true : undefined}
                  aria-describedby={`${descriptionId}-message`}
                  onChange={(e) => set("description", e.target.value)}
                />
              </Field>

              <div className="space-y-3 rounded-[12px] border border-line bg-surface-sunk/40 p-3">
                <Field
                  label="Question for the requester"
                  htmlFor={promptId}
                  error={errors.detail_prompt ?? null}
                  hint="Optional. One short question, like “Which printer? The name on its label.”"
                >
                  <Input
                    id={promptId}
                    data-field="detail_prompt"
                    value={form.detail_prompt}
                    maxLength={QUICK_TICKET_LIMITS.promptMax}
                    placeholder="Which printer? The name on its label, or where it is."
                    aria-invalid={errors.detail_prompt ? true : undefined}
                    aria-describedby={`${promptId}-message`}
                    onChange={(e) => set("detail_prompt", e.target.value)}
                  />
                </Field>
                <Switch
                  label="Answer required"
                  hint={hasPrompt ? "They can't send it without answering." : "Write a question first."}
                  checked={hasPrompt && form.detail_required}
                  disabled={!hasPrompt}
                  onChange={(value) => set("detail_required", value)}
                />
              </div>

              <Switch
                label={form.is_active ? "Live" : "Hidden"}
                hint={form.is_active ? "Requesters can use it." : "Saved, but not shown to requesters."}
                checked={form.is_active}
                onChange={(value) => set("is_active", value)}
              />
            </div>
          </fieldset>

          {/* -------------------------------------------------- preview -- */}
          <Preview form={current} group={group} rule={rule} startsAt={startsAt} />
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

        <div className="flex flex-wrap items-center gap-2">
          {editing && !gone && (
            confirmDelete ? (
              <div className="flex items-center gap-2">
                <Button type="button" variant="danger" loading={deleting} onClick={() => void remove()}>
                  Delete permanently
                </Button>
                <Button type="button" variant="ghost" autoFocus onClick={() => setConfirmDelete(false)} disabled={deleting}>
                  Keep it
                </Button>
              </div>
            ) : (
              <span title={used ? "Tickets were raised from it — hide it instead." : !usageKnown ? "Usage couldn't be loaded." : undefined}>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={used || !usageKnown || saving}
                  onClick={() => setConfirmDelete(true)}
                  className="text-[#e11d48] dark:text-[#fb7185]"
                >
                  Delete
                </Button>
              </span>
            )
          )}
          {editing && used && !confirmDelete && (
            <span className="min-w-0 flex-1 basis-40 text-[0.75rem] text-ink-faint">
              {usage!.total} ticket{usage!.total === 1 ? " was" : "s were"} raised from it — hide it instead of deleting.
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Button type="button" variant="ghost" onClick={onBack} disabled={saving || deleting}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={saving}
              disabled={gone || deleting || (editing && !dirty)}
            >
              {editing ? "Save changes" : "Add quick ticket"}
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
}

function Preview({
  form,
  group,
  rule,
  startsAt,
}: {
  form: Normalized;
  group: QuickTicketGroup | null;
  rule: RuleOption | null;
  startsAt: TicketPriority;
}) {
  const meta = PRIORITY_META[startsAt];
  const raised = startsAt === "urgent" || startsAt === "high";
  const blank = <span className="italic text-ink-faint">Not written yet</span>;

  return (
    <aside aria-label="Preview" className="min-w-0 space-y-3 @2xl:sticky @2xl:top-0 @2xl:self-start">
      <div>
        <p className="eyebrow mb-1.5">Requesters see</p>
        {/* The tile in the group's pop-up on the Quick tickets page. */}
        <div className="rounded-[12px] border border-line bg-surface-sunk/40 p-2">
          <div className="flex items-center gap-2 px-1 pb-2">
            <span className="flex size-6 flex-none items-center justify-center rounded-[7px] bg-accent text-[var(--accent-ink)]">
              <QuickIcon name={group?.icon ?? "bolt"} className="size-3.5" />
            </span>
            <span className="truncate text-[0.75rem] font-semibold text-ink">{group?.name ?? "Group"}</span>
          </div>
          <div className="flex flex-col gap-1.5 rounded-[10px] border border-line bg-surface p-2.5">
            <div className="flex items-start gap-2">
              <span className="line-clamp-2 min-w-0 flex-1 break-words text-[0.8125rem] font-medium leading-snug text-ink">
                {form.label || "Button label"}
              </span>
              <span className="flex size-5 flex-none items-center justify-center rounded-full border border-line text-ink-faint">
                <Icons.arrowRight className="size-3" />
              </span>
            </div>
            {(raised || form.detail_prompt) && (
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.6875rem] text-ink-faint">
                {raised && (
                  <span data-tone={meta.tone} className="inline-flex items-center gap-1">
                    <span className="tone-dot" />
                    {meta.label}
                  </span>
                )}
                {form.detail_prompt && <span>Asks one question</span>}
              </span>
            )}
          </div>
        </div>
      </div>

      <div>
        <p className="eyebrow mb-1.5">IT receives</p>
        <dl className="divide-y divide-line overflow-hidden rounded-[12px] border border-line bg-surface text-[0.75rem]">
          <div className="px-3 py-2">
            <dt className="eyebrow">Title</dt>
            <dd className="mt-0.5 break-words font-medium text-ink">
              {form.subject || blank}
              {form.detail_prompt && form.subject && (
                <span className="text-ink-faint"> · their answer</span>
              )}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-2 px-3 py-2">
            <dt className="eyebrow">Category</dt>
            <dd className={cn("min-w-0 truncate text-right", rule ? "text-ink" : "text-ink-faint")}>
              {rule?.category ?? "Not picked"}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-2 px-3 py-2">
            <dt className="eyebrow">Urgency</dt>
            <dd>
              <Badge tone={meta.tone} emphasis="quiet">
                {meta.label}
              </Badge>
            </dd>
          </div>
          <div className="px-3 py-2">
            <dt className="eyebrow">Details</dt>
            <dd className="mt-0.5 max-h-40 overflow-y-auto whitespace-pre-wrap break-words leading-relaxed text-ink-muted">
              {form.description || blank}
              {form.detail_prompt && (
                <>
                  {"\n\n"}
                  {form.detail_prompt}
                  {"\n"}
                  <span className="text-ink-faint">their answer</span>
                </>
              )}
            </dd>
          </div>
        </dl>
      </div>
    </aside>
  );
}

export function Banner({ tone, children }: { tone: "amber" | "rose"; children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={transition.fast}
      className="overflow-hidden"
    >
      <p
        role={tone === "rose" ? "alert" : "status"}
        data-tone={tone}
        className="mb-3 flex items-start gap-2 rounded-[10px] border border-[var(--tone-bd)] bg-[var(--tone-bg)] px-3 py-2 text-[0.8125rem] leading-relaxed text-[var(--tone-fg)]"
      >
        <Icons.alert className="mt-0.5 size-4 flex-none" />
        <span>{children}</span>
      </p>
    </motion.div>
  );
}
