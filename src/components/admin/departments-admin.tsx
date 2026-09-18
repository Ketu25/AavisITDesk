"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Switch } from "@/components/ui/field";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { EmptyState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { Icons } from "@/components/shell/icons";
import { api, ApiClientError } from "@/lib/api";
import { transition } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { Department } from "@/lib/database.types";
import { StaggerChildren } from "@/components/motion";

export type DepartmentMember = { id: string; full_name: string };

export type DepartmentUsage = {
  people: number;
  tickets: number;
  /** Capped on the server — `people` carries the true total. */
  members: DepartmentMember[];
};

type Usage = Record<string, DepartmentUsage>;

const EMPTY: DepartmentUsage = { people: 0, tickets: 0, members: [] };

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
    <StaggerChildren className="space-y-4">
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

      {departments.length === 0 ? (
        <div className="card overflow-hidden">
          <EmptyState
            icon={<Icons.building />}
            title="No departments yet"
            description="Add the first one above. Every ticket is tagged with a department, so this is worth getting right early."
          />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {departments.map((department, index) => (
            <DepartmentCard
              key={department.id}
              department={department}
              use={usage[department.id] ?? EMPTY}
              index={index}
              busy={busy}
              editing={editing === department.id}
              onEdit={() => setEditing(department.id)}
              onEditDone={() => setEditing(null)}
              onAct={act}
            />
          ))}
        </div>
      )}

      <p className="text-[0.75rem] leading-relaxed text-ink-faint">
        A retired department disappears from new-ticket routing and from the invite form, but every
        existing ticket keeps its tag so reporting stays accurate.
      </p>
    </StaggerChildren>
  );
}

function DepartmentCard({
  department,
  use,
  index,
  busy,
  editing,
  onEdit,
  onEditDone,
  onAct,
}: {
  department: Department;
  use: DepartmentUsage;
  index: number;
  busy: string | null;
  editing: boolean;
  onEdit: () => void;
  onEditDone: () => void;
  onAct: (key: string, run: () => Promise<unknown>, success: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(department.name);

  const inUse = use.people > 0 || use.tickets > 0;
  const retired = !department.is_active;
  const overflow = use.people - use.members.length;

  const items: MenuItem[] = [
    {
      label: "Rename",
      onSelect: () => {
        setDraft(department.name);
        onEdit();
      },
    },
    { separator: true },
    {
      label: "Remove permanently",
      danger: true,
      // A department still referenced by people or tickets cannot be deleted
      // without orphaning that history, so the menu says why rather than
      // failing at the API.
      disabled: inUse || busy === `delete-${department.id}`,
      hint: inUse
        ? "Still referenced by people or tickets — retire it instead."
        : "There is nothing referencing this department.",
      onSelect: () =>
        onAct(
          `delete-${department.id}`,
          () => api(`/api/admin/departments/${department.id}`, { method: "DELETE" }),
          "Department removed",
        ),
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...transition.fast, delay: Math.min(index, 8) * 0.03 }}
      className="card group relative flex flex-col overflow-hidden"
    >
      {/*
        Hover shading, not a moving glyph.

        The previous version slid oversized initials a few pixels on hover,
        which read as a layout wobble rather than as shading — at 68px the
        movement was large enough to notice against otherwise still cards.
        This is a radial bloom anchored in the top-right corner instead:
        invisible at rest, easing up under the pointer. Nothing translates, so
        nothing can wobble.

        The colour is --shimmer, the token the app already uses for a sheen,
        so it is light falling across the card in dark mode and ink pooling in
        the corner in light — theme-correct in both without a second value, and
        with no hue, which stays reserved for the SLA reading.
      */}
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0",
          "opacity-0 transition-opacity duration-300 ease-[var(--ease-standard)]",
          "group-hover:opacity-100 group-focus-within:opacity-100",
        )}
        style={{
          background:
            "radial-gradient(9rem 7rem at 100% 0%, var(--shimmer), transparent 72%)",
        }}
      />

      <div className="relative flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          {editing ? (
            <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!draft.trim()) return;
              onAct(
                `rename-${department.id}`,
                async () => {
                  await api(`/api/admin/departments/${department.id}`, {
                    method: "PATCH",
                    json: { name: draft.trim() },
                  });
                  onEditDone();
                },
                "Renamed",
              );
            }}
              className="flex min-w-0 flex-1 gap-2"
            >
              <Input
                value={draft}
                autoFocus
                aria-label={`Rename ${department.name}`}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && onEditDone()}
              />
              <Button
                type="submit"
                size="sm"
                variant="primary"
                loading={busy === `rename-${department.id}`}
                disabled={!draft.trim()}
              >
                Save
              </Button>
            </form>
          ) : (
            <h3 className="min-w-0 flex-1 truncate text-[0.9375rem] font-semibold tracking-tight text-ink">
              {department.name}
            </h3>
          )}

          {/* Anchored here rather than floating on the old band, so it keeps
              its place while the name swaps into a rename field. */}
          <div className="flex flex-none items-center gap-1">
            {!editing && (
              <Badge tone={retired ? "slate" : "emerald"}>
                {retired ? "Retired" : "Active"}
              </Badge>
            )}
            <Menu items={items} label={`Actions for ${department.name}`}>
              <Icons.more className="size-4" />
            </Menu>
          </div>
        </div>

        <dl className="flex items-center gap-4">
          <Stat label={use.people === 1 ? "person" : "people"} value={use.people} />
          <Stat label={use.tickets === 1 ? "ticket" : "tickets"} value={use.tickets} />
        </dl>

        {use.members.length > 0 ? (
          <div className="flex items-center gap-2">
            <div className="flex -space-x-1">
              {use.members.map((member) => (
                <Avatar
                  key={member.id}
                  name={member.full_name}
                  id={member.id}
                  size="sm"
                  className="ring-2 ring-[var(--canvas-raised)]"
                />
              ))}
            </div>
            {overflow > 0 && (
              <span className="tabular text-[0.6875rem] text-ink-faint">+{overflow}</span>
            )}
          </div>
        ) : (
          <p className="text-[0.75rem] text-ink-faint">Nobody assigned yet</p>
        )}
      </div>

      <div className="border-t border-line px-4 py-2.5">
        <Switch
          label={department.is_active ? "Active" : "Retired"}
          hint={department.is_active ? "Offered on new tickets" : "Hidden from new tickets"}
          checked={department.is_active}
          disabled={busy === `toggle-${department.id}`}
          onChange={(value) =>
            onAct(
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
    </motion.div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="sr-only">{label}</dt>
      <dd className="tabular text-[1.0625rem] font-semibold leading-none text-ink">{value}</dd>
      <span aria-hidden className="text-[0.75rem] text-ink-faint">
        {label}
      </span>
    </div>
  );
}
