"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Switch } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { Icons } from "@/components/shell/icons";
import { api, ApiClientError } from "@/lib/api";
import { PRIORITY_META } from "@/lib/constants";
import { TICKET_PRIORITIES, type RoutingRule } from "@/lib/database.types";

type Agent = { id: string; full_name: string };

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
    <div className="space-y-4">
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
                json: { category: newCategory.trim(), sort_order: (rules.length + 1) * 10 },
              });
              setNewCategory("");
            },
            "Category added",
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

      <div className="space-y-2">
        <AnimatePresence initial={false}>
          {rules.map((rule) => (
            <motion.div
              key={rule.id}
              layout="position"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, height: 0 }}
              className="card p-4"
            >
              <div className="mb-3.5 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[0.875rem] font-medium text-ink">{rule.category}</p>
                  {rule.description && (
                    <p className="mt-0.5 text-[0.75rem] text-ink-faint">{rule.description}</p>
                  )}
                </div>
                <div className="flex flex-none items-center gap-3">
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
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
