import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { RoutingAdmin } from "@/components/admin/routing-admin";

export const metadata: Metadata = { title: "Routing" };

export default async function AdminRoutingPage() {
  await requireAdmin();
  const supabase = await createClient();

  const [{ data: rules }, { data: agents }, { data: settings }] = await Promise.all([
    supabase.from("routing_rules").select("*").order("sort_order"),
    supabase
      .from("profiles")
      .select("id, full_name")
      .in("role", ["agent", "admin"])
      .eq("status", "active")
      .order("full_name"),
    supabase.from("app_settings").select("auto_assign_strategy").maybeSingle(),
  ]);

  return (
    <>
      <PageHeader
        title="Routing rules"
        description="These categories are the dropdown on the new-ticket form, and they decide the default owner."
      />
      <PageBody className="max-w-4xl">
        <RoutingAdmin
          rules={rules ?? []}
          agents={agents ?? []}
          autoAssignStrategy={settings?.auto_assign_strategy ?? "off"}
        />
      </PageBody>
    </>
  );
}
