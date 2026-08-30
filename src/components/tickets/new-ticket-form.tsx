"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { Icons } from "@/components/shell/icons";
import { api, ApiClientError } from "@/lib/api";
import { PRIORITY_META } from "@/lib/constants";
import { TICKET_PRIORITIES, type TicketPriority } from "@/lib/database.types";
import { cn } from "@/lib/utils";

type Category = {
  category: string;
  description: string | null;
  default_priority: TicketPriority | null;
};

export function NewTicketForm({
  categories,
  departmentName,
}: {
  categories: Category[];
  departmentName: string | null;
}) {
  const router = useRouter();
  const { push } = useToast();

  const [category, setCategory] = useState<string>("");
  const [priority, setPriority] = useState<TicketPriority>("normal");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const selected = categories.find((c) => c.category === category);

  function pickCategory(next: Category) {
    setCategory(next.category);
    if (next.default_priority) setPriority(next.default_priority);
    setErrors((e) => ({ ...e, category: "" }));
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};
    if (!category) nextErrors.category = "Pick the closest category.";
    if (subject.trim().length < 3) nextErrors.subject = "Give it a short title.";
    if (description.trim().length < 5) nextErrors.description = "Add a little more detail.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    setLoading(true);
    try {
      const result = await api<{ ticket: { id: string; ticket_number: string } }>("/api/tickets", {
        method: "POST",
        json: { subject, description, category, priority },
      });
      push({
        tone: "success",
        title: `${result.ticket.ticket_number} created`,
        description: "IT has been notified. You can track it in My tickets.",
      });
      router.push(`/tickets/${result.ticket.id}`);
      router.refresh();
    } catch (error) {
      setLoading(false);
      push({
        tone: "error",
        title: "Could not create the ticket",
        description: error instanceof ApiClientError ? error.message : "Please try again.",
      });
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="card p-5">
        <div className="flex items-center justify-between gap-3 border-b border-line pb-3.5">
          <div>
            <p className="text-[0.8125rem] font-medium text-ink">Your department</p>
            <p className="mt-0.5 text-xs text-ink-faint">
              Taken from your profile — IT can change it if it&apos;s wrong.
            </p>
          </div>
          <span className="flex-none rounded-lg border border-line bg-surface-sunk px-2.5 py-1 text-[0.8125rem] font-medium text-ink-muted">
            {departmentName ?? "Not set"}
          </span>
        </div>

        <div className="pt-4">
          <Field
            label="What kind of problem is it?"
            required
            error={errors.category || null}
            hint={selected?.description ?? undefined}
          >
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {categories.map((item) => {
                const active = item.category === category;
                return (
                  <button
                    key={item.category}
                    type="button"
                    onClick={() => pickCategory(item)}
                    className={cn(
                      "relative rounded-full border px-3 py-1.5 text-[0.8125rem] font-medium",
                      "transition-colors duration-150",
                      active
                        ? "border-accent-line text-accent"
                        : "border-line text-ink-muted hover:border-line-strong hover:text-ink",
                    )}
                  >
                    {active && (
                      <motion.span
                        layoutId="category-pill"
                        transition={{ type: "spring", stiffness: 480, damping: 36 }}
                        className="absolute inset-0 -z-10 rounded-full bg-accent-soft"
                      />
                    )}
                    {item.category}
                  </button>
                );
              })}
            </div>
          </Field>
        </div>
      </div>

      <div className="card space-y-4 p-5">
        <Field label="Title" htmlFor="subject" required error={errors.subject || null}>
          <Input
            id="subject"
            value={subject}
            maxLength={160}
            placeholder="Laptop won't connect to the shop-floor Wi-Fi"
            onChange={(e) => {
              setSubject(e.target.value);
              setErrors((x) => ({ ...x, subject: "" }));
            }}
          />
        </Field>

        <Field
          label="What's happening?"
          htmlFor="description"
          required
          error={errors.description || null}
          hint="When did it start, what have you already tried, and does it block your work?"
        >
          <Textarea
            id="description"
            rows={6}
            value={description}
            placeholder="Describe the problem in your own words…"
            onChange={(e) => {
              setDescription(e.target.value);
              setErrors((x) => ({ ...x, description: "" }));
            }}
          />
        </Field>

        <Field label="How urgent is it?" hint="IT may adjust this based on impact.">
          <div className="inline-flex rounded-[10px] border border-line bg-surface-sunk p-0.5">
            {TICKET_PRIORITIES.map((value) => {
              const active = value === priority;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setPriority(value)}
                  className={cn(
                    "relative rounded-[7px] px-3 py-1.5 text-[0.8125rem] font-medium",
                    "transition-colors duration-150",
                    active ? "text-ink" : "text-ink-faint hover:text-ink-muted",
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="priority-pill"
                      transition={{ type: "spring", stiffness: 480, damping: 36 }}
                      className="absolute inset-0 -z-10 rounded-[7px] border border-line bg-surface shadow-[var(--shadow-sm)]"
                    />
                  )}
                  {PRIORITY_META[value].label}
                </button>
              );
            })}
          </div>
        </Field>
      </div>

      <div className="flex items-center justify-between gap-3">
        <AnimatePresence>
          {priority === "urgent" && (
            <motion.p
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              className="text-xs text-ink-muted"
            >
              Urgent tickets page the IT channel immediately.
            </motion.p>
          )}
        </AnimatePresence>
        <Button
          type="submit"
          variant="primary"
          size="lg"
          loading={loading}
          icon={<Icons.check />}
          className="ml-auto"
        >
          Submit ticket
        </Button>
      </div>
    </form>
  );
}
