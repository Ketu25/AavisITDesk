"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Input, Switch } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { Icons } from "@/components/shell/icons";
import { api, ApiClientError } from "@/lib/api";
import type { Department } from "@/lib/database.types";

type Usage = Record<string, { people: number; tickets: number }>;

export function DepartmentsAdmin({
  departments,
  usage,
}: {
  departments: Department[];
  usage: Usage;
}) {
  const router = useRouter();
  const { push } = useToast();

  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
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
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!newName.trim()) return;
          act(
            "create",
            async () => {
              await api("/api/admin/departments", {
                method: "POST",
                json: { name: newName.trim(), sort_order: (departments.length + 1) * 10 },
              });
              setNewName("");
            },
            "Department added",
          );
        }}
        className="card flex gap-2 p-2.5"
      >
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Add a department — e.g. Regulatory Affairs"
          className="flex-1"
        />
        <Button
          type="submit"
          variant="primary"
          icon={<Icons.plus className="size-3.5" />}
          loading={busy === "create"}
          disabled={!newName.trim()}
        >
          Add
        </Button>
      </form>

      <div className="card divide-y divide-[var(--line)] overflow-hidden">
        <AnimatePresence initial={false}>
          {departments.map((department) => {
            const use = usage[department.id] ?? { people: 0, tickets: 0 };
            const inUse = use.people > 0 || use.tickets > 0;
            const isEditing = editing === department.id;

            return (
              <motion.div
                key={department.id}
                layout="position"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0 }}
                className="flex flex-wrap items-center gap-3 px-4 py-3"
              >
                <div className="min-w-[10rem] flex-1">
                  {isEditing ? (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        act(
                          `rename-${department.id}`,
                          async () => {
                            await api(`/api/admin/departments/${department.id}`, {
                              method: "PATCH",
                              json: { name: draft.trim() },
                            });
                            setEditing(null);
                          },
                          "Renamed",
                        );
                      }}
                      className="flex gap-2"
                    >
                      <Input
                        value={draft}
                        autoFocus
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={() => setEditing(null)}
                      />
                      <Button
                        type="submit"
                        size="sm"
                        variant="primary"
                        loading={busy === `rename-${department.id}`}
                        onMouseDown={(e) => e.preventDefault()}
                      >
                        Save
                      </Button>
                    </form>
                  ) : (
                    <button
                      onClick={() => {
                        setEditing(department.id);
                        setDraft(department.name);
                      }}
                      className="text-left"
                    >
                      <p className="text-[0.875rem] font-medium text-ink">{department.name}</p>
                      <p className="text-[0.75rem] text-ink-faint">
                        {use.people} {use.people === 1 ? "person" : "people"} · {use.tickets}{" "}
                        ticket{use.tickets === 1 ? "" : "s"}
                      </p>
                    </button>
                  )}
                </div>

                <div className="w-44 flex-none">
                  <Switch
                    label={department.is_active ? "Active" : "Retired"}
                    checked={department.is_active}
                    disabled={busy === `toggle-${department.id}`}
                    onChange={(value) =>
                      act(
                        `toggle-${department.id}`,
                        () =>
                          api(`/api/admin/departments/${department.id}`, {
                            method: "PATCH",
                            json: { is_active: value },
                          }),
                        value ? "Department reactivated" : "Department retired",
                      )
                    }
                  />
                </div>

                <Button
                  size="sm"
                  variant="danger"
                  disabled={inUse}
                  loading={busy === `delete-${department.id}`}
                  title={
                    inUse
                      ? "Still referenced by people or tickets — retire it instead."
                      : "Remove permanently"
                  }
                  onClick={() =>
                    act(
                      `delete-${department.id}`,
                      () =>
                        api(`/api/admin/departments/${department.id}`, { method: "DELETE" }),
                      "Department removed",
                    )
                  }
                >
                  Remove
                </Button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      <p className="text-[0.75rem] leading-relaxed text-ink-faint">
        A retired department disappears from new-ticket routing and from the invite form, but every
        existing ticket keeps its tag so reporting stays accurate.
      </p>
    </div>
  );
}
