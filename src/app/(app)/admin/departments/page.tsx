import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import {
  DepartmentsAdmin,
  type DepartmentUsage,
} from "@/components/admin/departments-admin";

export const metadata: Metadata = { title: "Departments" };

export default async function AdminDepartmentsPage() {
  await requireAdmin();
  const supabase = await createClient();

  const { data: departments } = await supabase
    .from("departments")
    .select("*")
    .order("sort_order");

  // Usage counts decide whether a department can be removed or only retired.
  // Names come along so each card can show who is actually in the department
  // rather than an abstract number; ordering keeps the faces stable between
  // renders instead of reshuffling on every refresh.
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name, department_id")
    .order("full_name");
  const { data: tickets } = await supabase.from("tickets").select("department_id");

  /** Faces shown per card. The count carries whatever is past this. */
  const FACES = 6;

  const usage = new Map<string, DepartmentUsage>();
  const blank = (): DepartmentUsage => ({ people: 0, tickets: 0, members: [] });

  for (const row of profiles ?? []) {
    if (!row.department_id) continue;
    const entry = usage.get(row.department_id) ?? blank();
    entry.people++;
    if (entry.members.length < FACES) {
      entry.members.push({ id: row.id, full_name: row.full_name });
    }
    usage.set(row.department_id, entry);
  }
  for (const row of tickets ?? []) {
    if (!row.department_id) continue;
    const entry = usage.get(row.department_id) ?? blank();
    entry.tickets++;
    usage.set(row.department_id, entry);
  }

  return (
    <>
      <PageHeader
        title="Departments"
        description="Used to tag every ticket. Retire one instead of deleting it to keep history readable."
      />
      <PageBody className="max-w-6xl">
        <DepartmentsAdmin
          departments={departments ?? []}
          usage={Object.fromEntries(usage)}
        />
      </PageBody>
    </>
  );
}
