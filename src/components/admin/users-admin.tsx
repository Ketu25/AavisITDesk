"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { Icons } from "@/components/shell/icons";
import { PeopleTable } from "./people-table";
import { CsvImport } from "./csv-import";
import { CredentialsPanel, type IssuedCredential } from "./credentials-panel";
import { api, ApiClientError } from "@/lib/api";
import { ROLE_META } from "@/lib/constants";
import { USER_ROLES, type Profile, type UserRole } from "@/lib/database.types";
import { StaggerChildren } from "@/components/motion";

type Department = { id: string; name: string };

export function UsersAdmin({
  users,
  departments,
  inviteExpiryHours,
  allowedDomains,
  viewerId,
  serviceKeyConfigured,
}: {
  users: Profile[];
  departments: Department[];
  inviteExpiryHours: number;
  allowedDomains: string[];
  viewerId: string;
  serviceKeyConfigured: boolean;
}) {
  const router = useRouter();
  const { push } = useToast();

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [reissued, setReissued] = useState<IssuedCredential[] | null>(null);

  // Staleness is measured against a clock read once on mount, so a re-render
  // never silently reclassifies a row mid-interaction.
  const [mountedAt] = useState(() => Date.now());

  const activationUrl =
    typeof window === "undefined" ? "/activate" : `${window.location.origin}/activate`;

  /** Replaces the password, revokes live sessions, and shows the new one once. */
  async function issueTempPassword(user: Profile) {
    setBusy(`temp-${user.id}`);
    try {
      const result = await api<{ user: IssuedCredential }>(
        `/api/admin/users/${user.id}/temp-password`,
        { method: "POST", json: {} },
      );
      setReissued([result.user]);
      router.refresh();
    } catch (error) {
      push({
        tone: "error",
        title: "Could not issue a password",
        description: error instanceof ApiClientError ? error.message : "Please try again.",
      });
    } finally {
      setBusy(null);
    }
  }

  const departmentName = useMemo(
    () => new Map(departments.map((d) => [d.id, d.name])),
    [departments],
  );

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return users.filter((user) => {
      if (roleFilter && user.role !== roleFilter) return false;
      if (statusFilter && user.status !== statusFilter) return false;
      if (term) {
        const haystack = `${user.full_name} ${user.email} ${
          departmentName.get(user.department_id ?? "") ?? ""
        }`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
  }, [users, search, roleFilter, statusFilter, departmentName]);

  const counts = useMemo(
    () => ({
      total: users.length,
      pending: users.filter((u) => u.status === "pending").length,
      disabled: users.filter((u) => u.status === "disabled").length,
      agents: users.filter((u) => u.role !== "user" && u.status === "active").length,
    }),
    [users],
  );

  function inviteIsStale(user: Profile) {
    if (user.status !== "pending") return false;
    const sentAt = user.last_invite_sent_at ?? user.invited_at;
    if (!sentAt) return true;
    return mountedAt - new Date(sentAt).getTime() > inviteExpiryHours * 3600_000;
  }

  async function act(key: string, run: () => Promise<unknown>, success: string) {
    setBusy(key);
    try {
      const result = (await run()) as { message?: string } | undefined;
      // Prefer the server's account of what happened — resend decides between
      // an invite and a reset link, and the admin should see which was sent.
      push({ tone: "success", title: result?.message ?? success });
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
      {!serviceKeyConfigured && (
        <div className="card border-[rgb(245_158_11_/_0.4)] bg-[rgb(245_158_11_/_0.06)] p-4">
          <p className="flex items-center gap-2 text-[0.875rem] font-medium text-ink">
            <Icons.alert className="size-4" />
            User provisioning is disabled
          </p>
          <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-ink-muted">
            Set <code className="rounded bg-surface-sunk px-1 py-0.5 font-mono text-xs">SUPABASE_SERVICE_ROLE_KEY</code>{" "}
            in <code className="rounded bg-surface-sunk px-1 py-0.5 font-mono text-xs">.env.local</code> and restart the
            server. Inviting, importing and enabling/disabling accounts all need it.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MiniStat label="People" value={counts.total} />
        <MiniStat label="Pending invites" value={counts.pending} tone={counts.pending ? "amber" : undefined} />
        <MiniStat label="Agents & admins" value={counts.agents} />
        <MiniStat label="Disabled" value={counts.disabled} />
      </div>

      <div className="card flex flex-wrap items-center gap-2 p-2.5">
        <div className="relative min-w-[12rem] flex-1">
          <Icons.search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-faint" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email or department…"
            className="pl-8"
          />
        </div>
        <Select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="w-auto min-w-[7.5rem]">
          <option value="">Any role</option>
          {USER_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_META[r].label}
            </option>
          ))}
        </Select>
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-auto min-w-[8rem]">
          <option value="">Any status</option>
          <option value="active">Active</option>
          <option value="pending">Pending</option>
          <option value="disabled">Disabled</option>
        </Select>
        <Button
          size="sm"
          variant="secondary"
          disabled={!serviceKeyConfigured}
          onClick={() => setImportOpen(true)}
        >
          Import CSV
        </Button>
        <Button
          size="sm"
          variant="primary"
          icon={<Icons.plus className="size-3.5" />}
          disabled={!serviceKeyConfigured}
          onClick={() => setAddOpen(true)}
        >
          Add user
        </Button>
      </div>

      <PeopleTable
        users={visible}
        total={users.length}
        departments={departments}
        viewerId={viewerId}
        serviceKeyConfigured={serviceKeyConfigured}
        busy={busy}
        inviteIsStale={inviteIsStale}
        onAct={act}
        onIssueTempPassword={issueTempPassword}
        filtersKey={`${search}|${roleFilter}|${statusFilter}`}
      />

      <AddUserModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        departments={departments}
        allowedDomains={allowedDomains}
        onDone={() => router.refresh()}
      />

      <Modal
        open={Boolean(reissued)}
        onClose={() => setReissued(null)}
        title="Temporary password issued"
        description="Any active session for this account has been signed out. Hand these details over directly."
        size="lg"
      >
        {reissued && (
          <CredentialsPanel
            credentials={reissued}
            activationUrl={activationUrl}
            onDone={() => setReissued(null)}
          />
        )}
      </Modal>

      <Modal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Bulk import from CSV"
        description="Columns: email, name, department, role. Everyone gets an invite email — no passwords are ever sent."
        size="lg"
      >
        <CsvImport
          departments={departments}
          onDone={() => {
            router.refresh();
          }}
        />
      </Modal>
    </StaggerChildren>
  );
}

function MiniStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "amber";
}) {
  return (
    <div data-tone={tone} className="card px-3 py-2.5">
      <p className="text-[0.6875rem] font-semibold uppercase tracking-wider text-ink-faint">
        {label}
      </p>
      <p
        className="tabular mt-0.5 text-lg font-semibold tracking-tight text-ink"
        style={tone && value > 0 ? { color: "var(--tone-fg)" } : undefined}
      >
        {value}
      </p>
    </div>
  );
}

function AddUserModal({
  open,
  onClose,
  departments,
  allowedDomains,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  departments: Department[];
  allowedDomains: string[];
  onDone: () => void;
}) {
  const { push } = useToast();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<UserRole>("user");
  const [departmentId, setDepartmentId] = useState("");
  const [password, setPassword] = useState("");
  const [byEmail, setByEmail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [issued, setIssued] = useState<IssuedCredential[] | null>(null);

  const activationUrl =
    typeof window === "undefined" ? "/activate" : `${window.location.origin}/activate`;

  function reset() {
    setEmail("");
    setName("");
    setRole("user");
    setDepartmentId("");
    setPassword("");
    setError(null);
    setIssued(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await api<{
        delivery: "temp_password" | "email_invite";
        user: IssuedCredential;
      }>("/api/admin/users", {
        method: "POST",
        json: {
          email,
          full_name: name,
          role,
          department_id: departmentId || null,
          password: password || null,
          delivery: byEmail ? "email_invite" : "temp_password",
        },
      });

      onDone();

      if (result.delivery === "email_invite") {
        push({
          tone: "success",
          title: "Invite emailed",
          description: `${email} will get a link to set their own password.`,
        });
        reset();
        onClose();
        return;
      }

      // Stay open: this is the only time the password is visible.
      setIssued([result.user]);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        onClose();
        reset();
      }}
      title={issued ? "Account created" : "Add someone"}
      description={
        issued
          ? "Hand these details to them directly — nothing was emailed."
          : "Creates the account with a temporary password you give them yourself. No email is sent, so this is not subject to any mail rate limit."
      }
      size={issued ? "lg" : "md"}
    >
      {issued ? (
        <CredentialsPanel
          credentials={issued}
          activationUrl={activationUrl}
          onDone={() => {
            onClose();
            reset();
          }}
        />
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field
            label="Work email"
            htmlFor="add-email"
            required
            error={error}
            hint={
              allowedDomains.length
                ? `Allowed domains: ${allowedDomains.join(", ")}`
                : "No domain allow-list is set — add one under Settings."
            }
          >
            <Input
              id="add-email"
              type="email"
              required
              autoFocus
              value={email}
              placeholder="name@aavispharma.com"
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>

          <Field label="Full name" htmlFor="add-name" required>
            <Input
              id="add-name"
              required
              value={name}
              placeholder="Priya Sharma"
              onChange={(e) => setName(e.target.value)}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Department" htmlFor="add-dept">
              <Select
                id="add-dept"
                value={departmentId}
                onChange={(e) => setDepartmentId(e.target.value)}
              >
                <option value="">No department</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Role" htmlFor="add-role" hint={ROLE_META[role].blurb}>
              <Select
                id="add-role"
                value={role}
                onChange={(e) => setRole(e.target.value as UserRole)}
              >
                {USER_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_META[r].label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {!byEmail && (
            <Field
              label="Temporary password"
              htmlFor="add-password"
              hint="Leave blank to generate a strong one. They must replace it before they can use the desk."
            >
              <div className="flex gap-2">
                <Input
                  id="add-password"
                  value={password}
                  placeholder="Generated automatically"
                  onChange={(e) => setPassword(e.target.value)}
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setPassword(generateReadablePassword())}
                >
                  Generate
                </Button>
              </div>
            </Field>
          )}

          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-line bg-surface-sunk p-3">
            <input
              type="checkbox"
              checked={byEmail}
              onChange={(e) => setByEmail(e.target.checked)}
              className="mt-0.5 size-3.5 accent-[var(--accent)]"
            />
            <span className="min-w-0">
              <span className="block text-[0.8125rem] font-medium text-ink">
                Email them an invite link instead
              </span>
              <span className="mt-0.5 block text-xs leading-relaxed text-ink-faint">
                Uses Supabase&apos;s mailer, which allows only a couple of messages an hour.
                Fine for one person, not for onboarding a team.
              </span>
            </span>
          </label>

          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={loading}>
              {byEmail ? "Send invite" : "Create account"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

/** Mirrors the server generator: unambiguous characters, grouped for reading
 *  aloud. The server generates its own when this is left blank. */
function generateReadablePassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghijkmnpqrstuvwxyz";
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}-${chars.slice(8, 12).join("")}`;
}
