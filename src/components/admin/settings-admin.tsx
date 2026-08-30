"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Switch } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { Icons } from "@/components/shell/icons";
import { createClient } from "@/lib/supabase/client";
import { api, ApiClientError } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import type { AppSettings, EmailAllowlist } from "@/lib/database.types";

type Agent = { id: string; full_name: string };
type Endpoint = { functions_base_url: string | null; secret_is_set: boolean };

const STRATEGIES = [
  { value: "off", label: "Manual only", hint: "New tickets stay unassigned until an agent picks them up." },
  { value: "least_busy", label: "Least busy", hint: "Goes to the agent with the fewest open tickets." },
  { value: "round_robin", label: "Round robin", hint: "Goes to whoever waited longest for a ticket." },
];

export function SettingsAdmin({
  settings,
  allowlist,
  agents,
  endpoint,
}: {
  settings: AppSettings;
  allowlist: EmailAllowlist[];
  agents: Agent[];
  endpoint: Endpoint;
}) {
  const router = useRouter();
  const { push } = useToast();

  const [domains, setDomains] = useState<string[]>(settings.allowed_email_domains ?? []);
  const [domainDraft, setDomainDraft] = useState("");
  const [allowEmail, setAllowEmail] = useState("");
  const [functionsUrl, setFunctionsUrl] = useState(endpoint.functions_base_url ?? "");
  const [rotatedSecret, setRotatedSecret] = useState<string | null>(null);
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
        title: "Could not save",
        description: error instanceof ApiClientError ? error.message : String(error),
      });
    } finally {
      setBusy(null);
    }
  }

  const patch = (json: Record<string, unknown>) =>
    api("/api/admin/settings", { method: "PATCH", json });

  function addDomain(event: React.FormEvent) {
    event.preventDefault();
    const value = domainDraft.trim().toLowerCase().replace(/^@/, "");
    if (!value) return;
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(value)) {
      push({ tone: "error", title: "That doesn't look like a domain." });
      return;
    }
    if (domains.includes(value)) {
      setDomainDraft("");
      return;
    }
    const next = [...domains, value];
    setDomains(next);
    setDomainDraft("");
    act("domains", () => patch({ allowed_email_domains: next }), `${value} allowed`);
  }

  function removeDomain(value: string) {
    const next = domains.filter((d) => d !== value);
    setDomains(next);
    act("domains", () => patch({ allowed_email_domains: next }), `${value} removed`);
  }

  return (
    <div className="space-y-4">
      {/* ------------------------------------------------- access control */}
      <Section
        title="Who can be given an account"
        description="Enforced server-side on every invite and on every profile write — not just in the UI."
      >
        <Field
          label="Allowed email domains"
          hint="Anyone at these domains can be invited."
        >
          <div className="flex flex-wrap gap-1.5 pb-2">
            <AnimatePresence initial={false}>
              {domains.map((domain) => (
                <motion.span
                  key={domain}
                  layout
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-sunk py-1 pl-2.5 pr-1.5 text-[0.8125rem] text-ink"
                >
                  @{domain}
                  <button
                    onClick={() => removeDomain(domain)}
                    aria-label={`Remove ${domain}`}
                    className="rounded-full p-0.5 text-ink-faint transition-colors hover:bg-surface-hover hover:text-ink"
                  >
                    <svg viewBox="0 0 16 16" className="size-3" fill="none">
                      <path d="m4 4 8 8m0-8-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </button>
                </motion.span>
              ))}
            </AnimatePresence>
            {domains.length === 0 && (
              <span className="text-[0.8125rem] text-[#e11d48] dark:text-[#fb7185]">
                No domains set — only the individual addresses below can be invited.
              </span>
            )}
          </div>
          <form onSubmit={addDomain} className="flex gap-2">
            <Input
              value={domainDraft}
              onChange={(e) => setDomainDraft(e.target.value)}
              placeholder="aavispharma.com"
            />
            <Button type="submit" variant="secondary" loading={busy === "domains"}>
              Add
            </Button>
          </form>
        </Field>

        <Field
          label="Individual exceptions"
          hint="Addresses outside those domains that are still allowed — contractors, shared mailboxes, the bootstrap admin."
        >
          <div className="space-y-1.5 pb-2">
            <AnimatePresence initial={false}>
              {allowlist.map((entry) => (
                <motion.div
                  key={entry.id}
                  layout
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center gap-2 rounded-lg border border-line bg-surface-sunk px-2.5 py-1.5"
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink">
                    {entry.email}
                  </span>
                  {entry.note && (
                    <span className="hidden flex-none text-[0.75rem] text-ink-faint sm:inline">
                      {entry.note}
                    </span>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={busy === `allow-${entry.id}`}
                    onClick={() =>
                      act(
                        `allow-${entry.id}`,
                        () => api(`/api/admin/allowlist/${entry.id}`, { method: "DELETE" }),
                        "Exception removed",
                      )
                    }
                  >
                    Remove
                  </Button>
                </motion.div>
              ))}
            </AnimatePresence>
            {allowlist.length === 0 && (
              <p className="text-[0.8125rem] text-ink-faint">No exceptions.</p>
            )}
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!allowEmail.trim()) return;
              act(
                "allow-add",
                async () => {
                  await api("/api/admin/allowlist", {
                    method: "POST",
                    json: { email: allowEmail.trim() },
                  });
                  setAllowEmail("");
                },
                "Address allowed",
              );
            }}
            className="flex gap-2"
          >
            <Input
              type="email"
              value={allowEmail}
              onChange={(e) => setAllowEmail(e.target.value)}
              placeholder="contractor@example.com"
            />
            <Button type="submit" variant="secondary" loading={busy === "allow-add"}>
              Allow
            </Button>
          </form>
        </Field>

        <Field
          label="Invite link validity (hours)"
          htmlFor="invite-expiry"
          hint="Used to flag stale invites in People. Supabase's own token lifetime is set under Authentication → Sessions."
        >
          <Input
            id="invite-expiry"
            type="number"
            min={1}
            max={720}
            defaultValue={settings.invite_expiry_hours}
            className="max-w-32"
            onBlur={(e) => {
              const value = Number(e.target.value);
              if (value === settings.invite_expiry_hours || !Number.isFinite(value)) return;
              act("expiry", () => patch({ invite_expiry_hours: value }), "Invite validity updated");
            }}
          />
        </Field>
      </Section>

      {/* -------------------------------------------------- assignment */}
      <Section
        title="Assignment"
        description="What happens the moment a ticket is created and no routing rule names an owner."
      >
        <Field label="Strategy" htmlFor="strategy">
          <Select
            id="strategy"
            defaultValue={settings.auto_assign_strategy}
            onChange={(e) =>
              act("strategy", () => patch({ auto_assign_strategy: e.target.value }), "Strategy updated")
            }
          >
            {STRATEGIES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
          <p className="pt-1 text-xs text-ink-faint">
            {STRATEGIES.find((s) => s.value === settings.auto_assign_strategy)?.hint}
          </p>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Escalate if unassigned after (minutes)"
            htmlFor="escalation"
            hint="Used by the escalation sweep."
          >
            <Input
              id="escalation"
              type="number"
              min={5}
              max={10080}
              defaultValue={settings.escalation_unassigned_minutes}
              onBlur={(e) => {
                const value = Number(e.target.value);
                if (value === settings.escalation_unassigned_minutes || !Number.isFinite(value)) return;
                act(
                  "escalation",
                  () => patch({ escalation_unassigned_minutes: value }),
                  "Escalation threshold updated",
                );
              }}
            />
          </Field>

          <Field label="Escalate to" htmlFor="lead" hint="Team lead notified on escalation.">
            <Select
              id="lead"
              defaultValue={settings.escalation_lead_id ?? ""}
              onChange={(e) =>
                act("lead", () => patch({ escalation_lead_id: e.target.value || null }), "Team lead updated")
              }
            >
              <option value="">Nobody specific</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.full_name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Section>

      {/* ----------------------------------------------- notifications */}
      <Section
        title="Notifications"
        description="Fired by a database trigger on ticket insert, so a ticket created by any route still notifies."
      >
        <Field
          label="Microsoft Teams incoming webhook URL"
          htmlFor="teams"
          hint="Teams channel → Connectors → Incoming Webhook (or a Workflows 'When a Teams webhook request is received' trigger). Leave blank to disable."
        >
          <Input
            id="teams"
            type="url"
            defaultValue={settings.teams_webhook_url ?? ""}
            placeholder="https://yourtenant.webhook.office.com/webhookb2/…"
            onBlur={(e) => {
              if (e.target.value === (settings.teams_webhook_url ?? "")) return;
              act("teams", () => patch({ teams_webhook_url: e.target.value }), "Teams webhook saved");
            }}
          />
        </Field>

        <Field
          label="IT distribution email"
          htmlFor="distro"
          hint="Fallback channel. Requires SMTP credentials on the edge function."
        >
          <Input
            id="distro"
            type="email"
            defaultValue={settings.it_distribution_email ?? ""}
            placeholder="it-helpdesk@aavispharma.com"
            onBlur={(e) => {
              if (e.target.value === (settings.it_distribution_email ?? "")) return;
              act("distro", () => patch({ it_distribution_email: e.target.value }), "Distribution list saved");
            }}
          />
        </Field>

        <div className="space-y-3 rounded-xl border border-line bg-surface-sunk p-3.5">
          <Switch
            label="Post to Teams"
            hint="Send an Adaptive Card to the channel on every new ticket."
            checked={settings.notify_teams_enabled}
            disabled={busy === "notify-teams"}
            onChange={(value) =>
              act("notify-teams", () => patch({ notify_teams_enabled: value }), "Saved")
            }
          />
          <Switch
            label="Email the distribution list"
            hint="Always-on fallback in case the Teams webhook fails."
            checked={settings.notify_email_enabled}
            disabled={busy === "notify-email"}
            onChange={(value) =>
              act("notify-email", () => patch({ notify_email_enabled: value }), "Saved")
            }
          />
        </div>

        <Field
          label="Edge function base URL"
          htmlFor="functions"
          hint="Where the database trigger posts. Usually https://<project-ref>.functions.supabase.co"
        >
          <div className="flex gap-2">
            <Input
              id="functions"
              type="url"
              value={functionsUrl}
              onChange={(e) => setFunctionsUrl(e.target.value)}
              placeholder="https://alslqimadvhrriwdkgrm.functions.supabase.co"
            />
            <Button
              variant="secondary"
              loading={busy === "functions"}
              onClick={() =>
                act(
                  "functions",
                  async () => {
                    const supabase = createClient();
                    const { error } = await supabase.rpc("set_notification_endpoint", {
                      p_url: functionsUrl,
                    });
                    if (error) throw new Error(error.message);
                  },
                  "Endpoint saved",
                )
              }
            >
              Save
            </Button>
          </div>
          <div className="flex items-center gap-2 pt-2">
            <Badge tone={endpoint.secret_is_set ? "emerald" : "amber"}>
              {endpoint.secret_is_set ? "Shared secret set" : "No shared secret"}
            </Badge>
            <Button
              size="sm"
              variant="ghost"
              loading={busy === "rotate"}
              onClick={() =>
                act(
                  "rotate",
                  async () => {
                    const supabase = createClient();
                    const { data, error } = await supabase.rpc("rotate_notification_secret");
                    if (error) throw new Error(error.message);
                    setRotatedSecret((data as { webhook_secret: string }).webhook_secret);
                  },
                  "Secret rotated",
                )
              }
            >
              Rotate secret
            </Button>
          </div>

          <AnimatePresence>
            {rotatedSecret && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-2 overflow-hidden"
              >
                <div className="rounded-lg border border-[rgb(245_158_11_/_0.4)] bg-[rgb(245_158_11_/_0.07)] p-3">
                  <p className="flex items-center gap-1.5 text-[0.8125rem] font-medium text-ink">
                    <Icons.alert className="size-3.5" />
                    Copy this now — it is not shown again
                  </p>
                  <code className="mt-2 block overflow-x-auto rounded bg-canvas px-2 py-1.5 font-mono text-[0.6875rem] text-ink">
                    {rotatedSecret}
                  </code>
                  <p className="mt-2 text-[0.75rem] leading-relaxed text-ink-muted">
                    Set it as <span className="font-mono">NOTIFY_WEBHOOK_SECRET</span> on the{" "}
                    <span className="font-mono">notify-new-ticket</span> edge function.
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </Field>
      </Section>

      {/* ------------------------------------------------------ general */}
      <Section title="Links" description="Used in notification messages that link back to a ticket.">
        <Field label="Application base URL" htmlFor="base-url">
          <Input
            id="base-url"
            type="url"
            defaultValue={settings.app_base_url ?? ""}
            placeholder="https://itdesk.aavispharma.com"
            onBlur={(e) => {
              if (e.target.value === (settings.app_base_url ?? "")) return;
              act("base", () => patch({ app_base_url: e.target.value }), "Base URL saved");
            }}
          />
        </Field>
        <p className="text-[0.75rem] text-ink-faint">
          Last changed {relativeTime(settings.updated_at)}.
        </p>
      </Section>
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card p-5">
      <div className="mb-4 border-b border-line pb-3">
        <h2 className="text-[0.875rem] font-semibold tracking-tight text-ink">{title}</h2>
        {description && (
          <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink-muted text-pretty">
            {description}
          </p>
        )}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}
