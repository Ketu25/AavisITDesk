import type { Metadata } from "next";
import Link from "next/link";
import { requireAgent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { Icons } from "@/components/shell/icons";
import { QuickTicketsAdmin, type QuickUsage } from "@/components/admin/quick-tickets-admin";
import { QuickTicketsOverview } from "@/components/admin/quick-tickets-overview";
import { QrLabels } from "@/components/admin/qr-labels";
import { QUICK_ISSUE_SELECT, groupQuickIssues, isQuickIcon } from "@/lib/quick-tickets";
import type { LabelGroup } from "@/lib/qr-labels";

type Props = { searchParams: Promise<{ labels?: string | string[] }> };

const HEADER_LINK =
  "inline-flex h-8 items-center gap-1.5 rounded-[9px] px-2.5 text-[0.8125rem] font-medium text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink";

/**
 * `?labels` opens the QR label printer, and `?labels=<group>` opens it on
 * that group. A view of this page rather than a page of its own: each page
 * route carries about 6 KiB of Next's own code into the Cloudflare Worker,
 * which is already close to its size limit.
 */
function labelsView(value: string | string[] | undefined) {
  if (value === undefined) return null;
  const group = Array.isArray(value) ? value[0] : value;
  return { group: group || null };
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  return { title: labelsView((await searchParams).labels) ? "QR labels" : "Quick ticket setup" };
}

/**
 * Admins manage quick tickets here. Agents come here too, to print the
 * groups' QR labels, and see them read-only — every write is refused to them
 * by the API and RLS regardless of what this page shows.
 */
export default async function AdminQuickTicketsPage({ searchParams }: Props) {
  const { isAdmin } = await requireAgent();
  const labels = labelsView((await searchParams).labels);
  if (labels) return <LabelPrinter isAdmin={isAdmin} groupId={labels.group} />;
  if (!isAdmin) return <AgentQuickTickets />;

  const supabase = await createClient();

  const [groupsRes, itemsRes, rulesRes, usageRes] = await Promise.all([
    supabase.from("quick_ticket_groups").select("*").order("sort_order").order("name"),
    supabase.from("quick_tickets").select("*").order("sort_order").order("label"),
    supabase
      .from("routing_rules")
      .select("id, category, is_active, default_priority")
      .order("sort_order")
      .order("category"),
    supabase.rpc("quick_ticket_usage"),
  ]);

  // An empty screen after a failed read would invite an admin to recreate
  // what is already there, so a failure says so instead.
  const failed = Boolean(groupsRes.error || itemsRes.error || rulesRes.error);
  if (failed) {
    console.error(
      "[admin/quick-tickets] load failed",
      groupsRes.error?.message ?? itemsRes.error?.message ?? rulesRes.error?.message,
    );
  }
  // Usage is a nicety; without it the screen still works, and the API still
  // refuses to delete a quick ticket that has raised tickets.
  if (usageRes.error) console.error("[admin/quick-tickets] usage failed", usageRes.error.message);

  const usage: Record<string, QuickUsage> = {};
  for (const row of usageRes.data ?? []) {
    usage[row.quick_ticket_id] = {
      total: Number(row.total),
      recent: Number(row.last_30_days),
      lastUsedAt: row.last_used_at,
    };
  }

  return (
    <>
      <PageHeader
        title="Quick ticket setup"
        description="Common problems, written up once, that requesters report in a couple of taps."
        actions={
          <>
            <Link href="/admin/quick-tickets?labels" className={HEADER_LINK}>
              <Icons.qr className="size-3.5" />
              QR labels
            </Link>
            <Link href="/quick-tickets" className={HEADER_LINK}>
              <Icons.bolt className="size-3.5" />
              Requester view
            </Link>
          </>
        }
      />
      <PageBody>
        <QuickTicketsAdmin
          groups={groupsRes.data ?? []}
          items={itemsRes.data ?? []}
          rules={rulesRes.data ?? []}
          usage={usage}
          usageKnown={!usageRes.error}
          failed={failed}
        />
      </PageBody>
    </>
  );
}

/** An agent's Quick ticket setup: what requesters can report, and the way to label it. */
async function AgentQuickTickets() {
  const supabase = await createClient();
  // RLS hands agents only what is live; groupQuickIssues decides it all the same.
  const { data, error } = await supabase.from("quick_tickets").select(QUICK_ISSUE_SELECT).eq("is_active", true);
  if (error) console.error("[admin/quick-tickets] agent list failed", error.message);

  return (
    <>
      <PageHeader
        title="Quick ticket setup"
        description="What requesters can report in a couple of taps — and labels that open it from a phone."
        actions={
          <Link
            href="/admin/quick-tickets?labels"
            className="inline-flex h-8 items-center gap-1.5 rounded-[9px] border border-line-strong bg-surface px-3 text-[0.8125rem] font-medium text-ink transition-colors hover:bg-surface-hover"
          >
            <Icons.qr className="size-3.5" />
            Print QR labels
          </Link>
        }
      />
      <PageBody>
        <QuickTicketsOverview
          groups={groupQuickIssues((data ?? []) as unknown as Record<string, unknown>[])}
          failed={Boolean(error)}
        />
      </PageBody>
    </>
  );
}

/**
 * QR labels for quick-ticket groups, printed onto Avery 5160 sheets and stuck
 * where the problems happen.
 *
 * Agents label what requesters can use right now — RLS shows them nothing
 * else. Admins also get the hidden groups and the ones with nothing live,
 * marked as such: they may be putting labels up before switching a group on.
 */
async function LabelPrinter({ isAdmin, groupId }: { isAdmin: boolean; groupId: string | null }) {
  const supabase = await createClient();

  const [issuesRes, groupsRes] = await Promise.all([
    supabase.from("quick_tickets").select(QUICK_ISSUE_SELECT).eq("is_active", true),
    isAdmin
      ? supabase.from("quick_ticket_groups").select("id, name, icon, is_active").order("sort_order").order("name")
      : null,
  ]);

  const error = issuesRes.error ?? groupsRes?.error ?? null;
  if (error) console.error("[admin/quick-tickets] labels load failed", error.message);

  // Live is what a requester can reach now: the test the Quick tickets page applies.
  const live = groupQuickIssues((issuesRes.data ?? []) as unknown as Record<string, unknown>[]);
  const liveIds = new Set(live.map((group) => group.id));
  const groups: LabelGroup[] = groupsRes
    ? (groupsRes.data ?? []).map((group) => ({
        id: group.id,
        name: group.name,
        icon: isQuickIcon(group.icon) ? group.icon : "bolt",
        status: !group.is_active ? "hidden" : liveIds.has(group.id) ? "live" : "empty",
      }))
    : live.map((group) => ({ id: group.id, name: group.name, icon: group.icon, status: "live" }));

  const initialGroupId = groupId && groups.some((group) => group.id === groupId) ? groupId : null;

  return (
    <>
      <PageHeader
        title="QR labels"
        description="Stick one where a problem happens: scanning it opens that group's quick tickets."
        actions={
          <Link href="/admin/quick-tickets" className={HEADER_LINK}>
            <Icons.arrowLeft className="size-3.5" />
            Quick ticket setup
          </Link>
        }
      />
      <PageBody>
        {/* Keyed by the group asked for, so Back or Forward to another one starts afresh with it. */}
        <QrLabels
          key={initialGroupId ?? "none"}
          groups={groups}
          initialGroupId={initialGroupId}
          isAdmin={isAdmin}
          failed={Boolean(error)}
        />
      </PageBody>
    </>
  );
}
