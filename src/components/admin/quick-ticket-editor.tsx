"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Switch, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { Icons } from "@/components/shell/icons";
import { QuickIcon } from "@/components/quick-tickets";
import { api, ApiClientError } from "@/lib/api";
import { PRIORITY_META, QUICK_TICKET_LIMITS, TICKET_LIMITS } from "@/lib/constants";
import { charCount, effectivePriority } from "@/lib/quick-tickets";
import { transition } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { QuickTicket, QuickTicketGroup, TicketPriority } from "@/lib/database.types";

export type RuleOption = {
  id: string;
  category: string;
  is_active: boolean;
  default_priority: TicketPriority | null;
};

export type EditorRequest =
  | { mode: "create"; groupId: string }
  | { mode: "edit"; id: string; groupId: string };

/** One opening of the editor; a new key per open starts it fresh. */
export type EditorSession = EditorRequest & { key: number };

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

/**
 * Creating or editing one quick ticket, beside a preview of what requesters
 * will see and what IT will receive.
 *
 * An edit sends only the fields that changed, along with the revision the
 * editor opened; if another admin saved first, the server refuses and the
 * editor says so rather than overwriting them. Edits that arrive from
 * elsewhere while nothing has been typed are simply taken in.
 */
export function QuickTicketEditor({
  open,
  session,
  item,
  groups,
  rules,
  usage,
  usageKnown,
  onClose,
}: {
  open: boolean;
  session: EditorSession;
  /** The quick ticket being edited, read live; null once deleted. */
  item: QuickTicket | null;
  groups: QuickTicketGroup[];
  rules: RuleOption[];
  usage: { total: number } | null;
  usageKnown: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { push } = useToast();
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
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
  const [confirmDiscard, setConfirmDiscard] = useState(false);
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
  const startsAt = effectivePriority(form.priority, rule?.default_priority);
  const lifted = startsAt !== form.priority;
  const hasPrompt = current.detail_prompt !== null;
  const used = (usage?.total ?? 0) > 0;

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
    setConfirmDiscard(false);
  }

  function focusField(field: FieldName) {
    const node = rootRef.current?.querySelector<HTMLElement>(`[data-field="${field}"]`);
    // On a pointer screen a dropdown's native select is hidden under the
    // drawn trigger, which is what should take focus.
    const trigger =
      node instanceof HTMLSelectElement && node.getAttribute("aria-hidden") === "true"
        ? node.parentElement?.querySelector<HTMLElement>('[role="combobox"]')
        : null;
    (trigger ?? node)?.focus();
  }

  function requestClose() {
    if (saving || deleting) return;
    if (dirty && !gone && !confirmDiscard) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
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
  }

  async function save() {
    if (saving || deleting || gone) return;
    const problems = validate(form);
    const first = FIELD_ORDER.find((field) => problems[field]);
    if (first) {
      setErrors(problems);
      focusField(first);
      return;
    }

    setSaving(true);
    setFailure(null);
    try {
      if (!editing) {
        await api("/api/admin/quick-tickets", { method: "POST", json: current });
        push({ tone: "success", title: "Quick ticket added", description: current.is_active ? "Requesters can use it now." : "It's hidden until you switch it live." });
      } else {
        const was = normalized(base);
        const changes = Object.fromEntries(
          (Object.keys(current) as (keyof Normalized)[])
            .filter((key) => current[key] !== was[key])
            .map((key) => [key, current[key]]),
        );
        if (Object.keys(changes).length === 0) {
          onClose();
          return;
        }
        const touchesContent = Object.keys(changes).some((key) => key !== "is_active");
        await api(`/api/admin/quick-tickets/${session.id}`, {
          method: "PATCH",
          json: touchesContent ? { ...changes, expected_revision: seenRevision } : changes,
        });
        push({ tone: "success", title: "Quick ticket saved" });
      }
      // What was just saved is the new baseline, so the refresh carrying it
      // is taken in quietly rather than read as someone else's edit.
      setBase(form);
      router.refresh();
      onClose();
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
      onClose();
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
      if (first) focusField(first);
      setFailure(first ? null : error.message);
      return;
    }
    if (typeof reason.field === "string" && reason.field in form) {
      setErrors({ [reason.field]: error.message });
      focusField(reason.field as FieldName);
      return;
    }
    if (reason.reason === "reference") router.refresh();
    setFailure(error.message);
  }

  async function remove() {
    if (!editing || saving || deleting) return;
    setDeleting(true);
    try {
      await api(`/api/admin/quick-tickets/${session.id}`, { method: "DELETE" });
      push({ tone: "success", title: "Quick ticket deleted" });
      setBase(form);
      router.refresh();
      onClose();
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

  return (
    <Modal
      open={open}
      onClose={requestClose}
      size="lg"
      title={editing ? `Edit “${item?.label ?? base.label}”` : "New quick ticket"}
      description={
        editing
          ? "Changes apply to the next ticket raised with it. Tickets already sent keep what they said."
          : "Write it the way the requester would — they'll see exactly this before they send it."
      }
    >
      <div ref={rootRef}>
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

        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
          className="grid gap-5 md:grid-cols-[minmax(0,1fr)_17rem]"
        >
          {/* ----------------------------------------------------- fields -- */}
          <fieldset disabled={saving || deleting || gone} className="min-w-0 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Button label" htmlFor={labelId} required error={errors.label ?? null} hint="What requesters pick.">
                <Input
                  id={labelId}
                  data-field="label"
                  data-autofocus={!editing || undefined}
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

            <div className="grid gap-4 sm:grid-cols-2">
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
          </fieldset>

          {/* ---------------------------------------------------- preview -- */}
          <Preview form={current} group={group} rule={rule} startsAt={startsAt} />

          {/* ----------------------------------------------------- footer -- */}
          <div className="space-y-3 border-t border-line pt-4 md:col-span-2">
            <AnimatePresence initial={false}>
              {failure && (
                <Banner key="failure" tone="rose">
                  {failure}
                </Banner>
              )}
              {confirmDiscard && (
                <Banner key="discard" tone="amber">
                  You have unsaved changes. Close anyway and lose them?{" "}
                  <button type="button" onClick={onClose} className="font-medium underline underline-offset-2">
                    Discard changes
                  </button>
                </Banner>
              )}
            </AnimatePresence>

            <div className="flex flex-wrap items-center gap-2">
              {editing && !gone && (
                confirmDelete ? (
                  <div className="flex items-center gap-2">
                    <Button variant="danger" loading={deleting} onClick={() => void remove()}>
                      Delete permanently
                    </Button>
                    <Button variant="ghost" onClick={() => setConfirmDelete(false)} disabled={deleting}>
                      Keep it
                    </Button>
                  </div>
                ) : (
                  <span title={used ? "Tickets were raised from it — hide it instead." : !usageKnown ? "Usage couldn't be loaded." : undefined}>
                    <Button
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
                <span className="text-[0.75rem] text-ink-faint">
                  {usage!.total} ticket{usage!.total === 1 ? " was" : "s were"} raised from it — hide it instead of deleting.
                </span>
              )}
              <div className="ml-auto flex items-center gap-2">
                <Button variant="ghost" onClick={requestClose} disabled={saving || deleting}>
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
      </div>
    </Modal>
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
  const blank = <span className="italic text-ink-faint">Not written yet</span>;

  return (
    <aside aria-label="Preview" className="min-w-0 space-y-3 md:sticky md:top-0 md:self-start">
      <div>
        <p className="eyebrow mb-1.5">Requesters see</p>
        <div className="rounded-[12px] border border-line bg-surface p-2">
          <div className="flex items-center gap-2 px-1.5 pb-1.5">
            <span className="flex size-6 flex-none items-center justify-center rounded-[7px] border border-line text-ink-muted">
              <QuickIcon name={group?.icon ?? "bolt"} className="size-3.5" />
            </span>
            <span className="truncate text-[0.75rem] font-semibold text-ink">{group?.name ?? "Group"}</span>
          </div>
          <div className="flex items-center gap-2 rounded-[8px] bg-surface-hover px-2 py-1.5 text-[0.8125rem] text-ink">
            <span className="min-w-0 flex-1 truncate">{form.label || "Button label"}</span>
            <Icons.arrowRight className="size-3.5 flex-none text-ink-faint" />
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

function Banner({ tone, children }: { tone: "amber" | "rose"; children: React.ReactNode }) {
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
