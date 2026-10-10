import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { SlaAdmin } from "@/components/admin/sla-admin";

export const metadata: Metadata = { title: "SLA rules" };

export default async function AdminSlaPage() {
  await requireAdmin();
  const supabase = await createClient();

  // Ordered by urgency in the component, which also accounts for a priority
  // that has no row at all.
  const { data: rules } = await supabase.from("sla_rules").select("*");

  return (
    <>
      <PageHeader
        title="SLA rules"
        description="Target resolution time per priority. Applied to new tickets the moment you save."
      />
      <PageBody className="max-w-6xl">
        <SlaAdmin rules={rules ?? []} />
      </PageBody>
    </>
  );
}
