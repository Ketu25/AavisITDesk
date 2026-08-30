import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { SettingsAdmin } from "@/components/admin/settings-admin";

export const metadata: Metadata = { title: "Settings" };

export default async function AdminSettingsPage() {
  await requireAdmin();
  const supabase = await createClient();

  const [{ data: settings }, { data: allowlist }, { data: agents }, { data: endpoint }] =
    await Promise.all([
      supabase.from("app_settings").select("*").maybeSingle(),
      supabase.from("email_allowlist").select("*").order("created_at"),
      supabase
        .from("profiles")
        .select("id, full_name")
        .in("role", ["agent", "admin"])
        .eq("status", "active")
        .order("full_name"),
      supabase.rpc("get_notification_endpoint"),
    ]);

  if (!settings) {
    return (
      <>
        <PageHeader title="Settings" />
        <PageBody>
          <div className="card p-5 text-[0.8125rem] text-ink-muted">
            The settings row is missing. Re-run the seed migration.
          </div>
        </PageBody>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Settings"
        description="Access control, notifications and how work gets assigned."
      />
      <PageBody className="max-w-3xl">
        <SettingsAdmin
          settings={settings}
          allowlist={allowlist ?? []}
          agents={agents ?? []}
          endpoint={
            (endpoint as { functions_base_url: string | null; secret_is_set: boolean } | null) ?? {
              functions_base_url: null,
              secret_is_set: false,
            }
          }
        />
      </PageBody>
    </>
  );
}
