import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { SlaAdmin } from "@/components/admin/sla-admin";

export const metadata: Metadata = { title: "SLA rules" };

export default async function AdminSlaPage() {
  await requireAdmin();
  const supabase = await createClient();

  const { data: rules } = await supabase.from("sla_rules").select("*");

  const ordered = ["urgent", "high", "normal", "low"];
  const sorted = (rules ?? []).sort(
    (a, b) => ordered.indexOf(a.priority) - ordered.indexOf(b.priority),
  );

  return (
    <>
      <PageHeader
        title="SLA rules"
        description="Target resolution time per priority. Applied to new tickets the moment you save."
      />
      <PageBody className="max-w-3xl">
        <SlaAdmin rules={sorted} />
      </PageBody>
    </>
  );
}
