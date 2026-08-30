import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { DepartmentsAdmin } from "@/components/admin/departments-admin";

export const metadata: Metadata = { title: "Departments" };

export default async function AdminDepartmentsPage() {
  await requireAdmin();
  const supabase = await createClient();

  const { data: departments } = await supabase
    .from("departments")
    .select("*")
    .order("sort_order");

  // Usage counts decide whether a department can be removed or only retired.
  const { data: profiles } = await supabase.from("profiles").select("department_id");
  const { data: tickets } = await supabase.from("tickets").select("department_id");

  const usage = new Map<string, { people: number; tickets: number }>();
  for (const row of profiles ?? []) {
    if (!row.department_id) continue;
    const entry = usage.get(row.department_id) ?? { people: 0, tickets: 0 };
    entry.people++;
    usage.set(row.department_id, entry);
  }
  for (const row of tickets ?? []) {
    if (!row.department_id) continue;
    const entry = usage.get(row.department_id) ?? { people: 0, tickets: 0 };
    entry.tickets++;
    usage.set(row.department_id, entry);
  }

  return (
    <>
      <PageHeader
        title="Departments"
        description="Used to tag every ticket. Retire one instead of deleting it to keep history readable."
      />
      <PageBody className="max-w-3xl">
        <DepartmentsAdmin
          departments={departments ?? []}
          usage={Object.fromEntries(usage)}
        />
      </PageBody>
    </>
  );
}
