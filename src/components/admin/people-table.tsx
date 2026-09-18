"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { EmptyState } from "@/components/ui/states";
import { Icons } from "@/components/shell/icons";
import { api } from "@/lib/api";
import { ROLE_META, USER_STATUS_META } from "@/lib/constants";
import { relativeTime } from "@/lib/format";
import { USER_ROLES, type Profile } from "@/lib/database.types";
import { transition } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * The People directory.
 *
 * The previous version was a flex-wrap row list: a flex-1 name block followed
 * by badges of varying width, then two selects and up to four buttons. Nothing
 * lined up between one row and the next, because nothing established a column —
 * there was even a fixed-width spacer span to fake alignment on the viewer's
 * own row. This is a real table, so the columns align by construction.
 *
 * The edits an admin makes constantly — role and department — stay inline as
 * columns. The occasional ones (issue a password, disable, re-enable) moved
 * into a per-row menu, which is what took four buttons off every row.
 */

type Department = { id: string; name: string };

const PAGE_SIZE = 25;

/**
 * Rows arrive but do not leave. An exit animation is right for one row being
 * removed and wrong for a page change, which replaces the whole set: twenty-five
 * rows fading out on top of the five fading in reads as a glitch, however
 * briefly. React unmounts them immediately instead, keyed by user id.
 */
const HEAD =
  "px-4 py-2.5 text-left text-[0.6875rem] font-semibold uppercase tracking-wider text-ink-faint";

export function PeopleTable({
  users,
  total,
  departments,
  viewerId,
  serviceKeyConfigured,
  busy,
  inviteIsStale,
  onAct,
  onIssueTempPassword,
  filtersKey,
}: {
  users: Profile[];
  total: number;
  departments: Department[];
  viewerId: string;
  serviceKeyConfigured: boolean;
  busy: string | null;
  inviteIsStale: (user: Profile) => boolean;
  onAct: (key: string, run: () => Promise<unknown>, success: string) => Promise<void>;
  onIssueTempPassword: (user: Profile) => void;
  /** Changes whenever a filter does, so the view can return to page one. */
  filtersKey: string;
}) {
  const [page, setPage] = useState(1);
  const [seenFilters, setSeenFilters] = useState(filtersKey);

  // Adjusting state during render rather than in an effect: React re-runs the
  // component before painting, so the first page is never briefly the wrong
  // one. This is the documented alternative to a reset effect, and it keeps to
  // the project's rule against setState in an effect body.
  if (filtersKey !== seenFilters) {
    setSeenFilters(filtersKey);
    setPage(1);
  }

  const pageCount = Math.max(1, Math.ceil(users.length / PAGE_SIZE));
  // Derived rather than synced. Filtering down to fewer pages while sitting on
  // a high page would otherwise show an empty table until something reset it.
  const current = Math.min(page, pageCount);
  const rows = users.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  if (users.length === 0) {
    return (
      <div className="card overflow-hidden">
        <EmptyState
          icon={<Icons.people />}
          title="Nobody matches"
          description={
            total === 0
              ? "Invite someone, or import a list of people from CSV."
              : "Adjust the filters, or invite someone new."
          }
        />
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      {/* Table for pointers and room; cards below md, where six columns cannot
          fit without a horizontal scroll that hides the actions. */}
      <div className="hidden md:block">
        <table className="w-full border-collapse">
          <caption className="sr-only">
            People with access to the desk, with their department, role and status
          </caption>
          <thead>
            <tr className="border-b border-line bg-surface-sunk/60">
              <th scope="col" className={HEAD}>
                Person
              </th>
              <th scope="col" className={cn(HEAD, "w-[11rem]")}>
                Department
              </th>
              <th scope="col" className={cn(HEAD, "w-[8.5rem]")}>
                Role
              </th>
              <th scope="col" className={cn(HEAD, "w-[10rem]")}>
                Status
              </th>
              <th scope="col" className={cn(HEAD, "w-[12rem]")}>
                Last activity
              </th>
              <th scope="col" className={cn(HEAD, "w-14")}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
              {rows.map((user, index) => (
                <motion.tr
                  key={user.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ ...transition.fast, delay: Math.min(index, 10) * 0.012 }}
                  className="border-b border-line transition-colors duration-150 last:border-b-0 hover:bg-surface-hover"
                >
                  <td className="px-4 py-2.5">
                    <PersonCell user={user} isSelf={user.id === viewerId} />
                  </td>
                  <td className="px-4 py-2.5">
                    <DepartmentSelect
                      user={user}
                      departments={departments}
                      disabled={!serviceKeyConfigured || busy === `dept-${user.id}`}
                      onAct={onAct}
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <RoleSelect
                      user={user}
                      disabled={
                        !serviceKeyConfigured ||
                        user.id === viewerId ||
                        busy === `role-${user.id}`
                      }
                      onAct={onAct}
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusCell user={user} stale={inviteIsStale(user)} />
                  </td>
                  <td className="px-4 py-2.5 text-[0.8125rem] leading-snug text-ink-muted">
                    <ActivityCell user={user} />
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex justify-end">
                      <RowMenu
                        user={user}
                        isSelf={user.id === viewerId}
                        serviceKeyConfigured={serviceKeyConfigured}
                        busy={busy}
                        onAct={onAct}
                        onIssueTempPassword={onIssueTempPassword}
                      />
                    </div>
                  </td>
                </motion.tr>
              ))}
          </tbody>
        </table>
      </div>

      <ul className="md:hidden">
          {rows.map((user, index) => (
            <motion.li
              key={user.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ ...transition.fast, delay: Math.min(index, 10) * 0.012 }}
              className="space-y-3 border-b border-line p-4 last:border-b-0"
            >
              <div className="flex items-start justify-between gap-3">
                <PersonCell user={user} isSelf={user.id === viewerId} />
                <RowMenu
                  user={user}
                  isSelf={user.id === viewerId}
                  serviceKeyConfigured={serviceKeyConfigured}
                  busy={busy}
                  onAct={onAct}
                  onIssueTempPassword={onIssueTempPassword}
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <StatusCell user={user} stale={inviteIsStale(user)} />
                <span className="text-[0.75rem] text-ink-faint">
                  <ActivityCell user={user} />
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <DepartmentSelect
                  user={user}
                  departments={departments}
                  disabled={!serviceKeyConfigured || busy === `dept-${user.id}`}
                  onAct={onAct}
                />
                <RoleSelect
                  user={user}
                  disabled={
                    !serviceKeyConfigured || user.id === viewerId || busy === `role-${user.id}`
                  }
                  onAct={onAct}
                />
              </div>
            </motion.li>
          ))}
      </ul>

      <Pagination
        page={current}
        pageCount={pageCount}
        from={(current - 1) * PAGE_SIZE + 1}
        to={Math.min(current * PAGE_SIZE, users.length)}
        shown={users.length}
        total={total}
        onPage={setPage}
      />
    </div>
  );
}

function PersonCell({ user, isSelf }: { user: Profile; isSelf: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar name={user.full_name} id={user.id} size="md" />
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 truncate text-[0.875rem] font-medium text-ink">
          {user.full_name}
          {isSelf && (
            <span className="flex-none rounded border border-line px-1 py-px text-[0.625rem] font-normal text-ink-faint">
              you
            </span>
          )}
        </p>
        <p className="truncate text-[0.75rem] text-ink-faint">{user.email}</p>
      </div>
    </div>
  );
}

function StatusCell({ user, stale }: { user: Profile; stale: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge tone={USER_STATUS_META[user.status].tone}>
        {USER_STATUS_META[user.status].label}
      </Badge>
      {stale && (
        <Badge tone="rose" dot={false}>
          Invite expired
        </Badge>
      )}
    </div>
  );
}

/** The one line that says where this account actually stands. */
function ActivityCell({ user }: { user: Profile }) {
  if (user.status === "disabled") return <>Disabled {relativeTime(user.disabled_at)}</>;
  if (user.password_set_at) return <>Active since {relativeTime(user.activated_at)}</>;
  return (
    <>
      Invited {relativeTime(user.last_invite_sent_at ?? user.invited_at)}
      <span className="text-ink-faint"> · no password yet</span>
    </>
  );
}

function DepartmentSelect({
  user,
  departments,
  disabled,
  onAct,
}: {
  user: Profile;
  departments: Department[];
  disabled: boolean;
  onAct: (key: string, run: () => Promise<unknown>, success: string) => Promise<void>;
}) {
  return (
    <Select
      aria-label={`Department for ${user.full_name}`}
      value={user.department_id ?? ""}
      disabled={disabled}
      onChange={(e) =>
        onAct(
          `dept-${user.id}`,
          () =>
            api(`/api/admin/users/${user.id}`, {
              method: "PATCH",
              json: { department_id: e.target.value || null },
            }),
          "Department updated",
        )
      }
    >
      <option value="">No department</option>
      {departments.map((d) => (
        <option key={d.id} value={d.id}>
          {d.name}
        </option>
      ))}
    </Select>
  );
}

function RoleSelect({
  user,
  disabled,
  onAct,
}: {
  user: Profile;
  disabled: boolean;
  onAct: (key: string, run: () => Promise<unknown>, success: string) => Promise<void>;
}) {
  return (
    <Select
      aria-label={`Role for ${user.full_name}`}
      value={user.role}
      disabled={disabled}
      onChange={(e) =>
        onAct(
          `role-${user.id}`,
          () =>
            api(`/api/admin/users/${user.id}`, {
              method: "PATCH",
              json: { role: e.target.value },
            }),
          "Role updated",
        )
      }
    >
      {USER_ROLES.map((r) => (
        <option key={r} value={r}>
          {ROLE_META[r].label}
        </option>
      ))}
    </Select>
  );
}

function RowMenu({
  user,
  isSelf,
  serviceKeyConfigured,
  busy,
  onAct,
  onIssueTempPassword,
}: {
  user: Profile;
  isSelf: boolean;
  serviceKeyConfigured: boolean;
  busy: string | null;
  onAct: (key: string, run: () => Promise<unknown>, success: string) => Promise<void>;
  onIssueTempPassword: (user: Profile) => void;
}) {
  const working = busy === `temp-${user.id}` || busy === `status-${user.id}`;
  const items: MenuItem[] = [];

  // Issuing yourself a password would sign you out mid-session, so the server
  // refuses it; the menu should not offer it either.
  if (!isSelf && user.status !== "disabled") {
    items.push({
      label: "Issue new password",
      hint: "Shows a temporary password once and signs out any active session.",
      disabled: !serviceKeyConfigured || working,
      onSelect: () => onIssueTempPassword(user),
    });
  }

  if (!isSelf) {
    if (items.length > 0) items.push({ separator: true });
    items.push(
      user.status === "disabled"
        ? {
            label: "Re-enable account",
            disabled: !serviceKeyConfigured || working,
            onSelect: () =>
              onAct(
                `status-${user.id}`,
                () =>
                  api(`/api/admin/users/${user.id}`, {
                    method: "PATCH",
                    json: { status: "active" },
                  }),
                "Account re-enabled",
              ),
          }
        : {
            label: "Disable account",
            hint: "Blocks sign-in. Every ticket and comment is kept.",
            danger: true,
            disabled: !serviceKeyConfigured || working,
            onSelect: () =>
              onAct(
                `status-${user.id}`,
                () =>
                  api(`/api/admin/users/${user.id}`, {
                    method: "PATCH",
                    json: { status: "disabled" },
                  }),
                "Account disabled",
              ),
          },
    );
  }

  // Your own row has nothing to offer: you cannot disable yourself, change your
  // own role, or issue yourself a password. An empty menu would be a dead end,
  // and so would one whose every entry is greyed out — which is what happens
  // with no service-role key, since all of these need it.
  const actionable = items.some((item) => !item.separator && !item.disabled);
  if (items.length === 0 || !actionable) {
    return <span className="inline-block size-8" aria-hidden />;
  }

  return (
    <Menu items={items} label={`Actions for ${user.full_name}`} disabled={working}>
      {working ? (
        <Icons.refresh className="size-4 animate-spin" />
      ) : (
        <Icons.more className="size-4" />
      )}
    </Menu>
  );
}

function Pagination({
  page,
  pageCount,
  from,
  to,
  shown,
  total,
  onPage,
}: {
  page: number;
  pageCount: number;
  from: number;
  to: number;
  shown: number;
  total: number;
  onPage: (page: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-2.5">
      <p className="tabular text-[0.75rem] text-ink-faint">
        {from}–{to} of {shown}
        {shown !== total && <span> filtered from {total}</span>}
      </p>

      {pageCount > 1 && (
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            disabled={page === 1}
            onClick={() => onPage(page - 1)}
          >
            Previous
          </Button>
          <span className="tabular px-1 text-[0.75rem] text-ink-muted">
            Page {page} of {pageCount}
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={page === pageCount}
            onClick={() => onPage(page + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
