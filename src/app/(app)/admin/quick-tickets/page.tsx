import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { QuickTicketsAdmin, type QuickUsage } from "@/components/admin/quick-tickets-admin";

export const metadata: Metadata = { title: "Quick ticket setup" };

export default async function AdminQuickTicketsPage() {
  await requireAdmin();
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
      />
      <PageBody className="max-w-4xl">
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
