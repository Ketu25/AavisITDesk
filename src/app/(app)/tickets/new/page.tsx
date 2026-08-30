import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { NewTicketForm } from "@/components/tickets/new-ticket-form";

export const metadata: Metadata = { title: "New ticket" };

export default async function NewTicketPage() {
  const { profile } = await requireUser();
  const supabase = await createClient();

  const [{ data: categories }, { data: department }] = await Promise.all([
    supabase
      .from("routing_rules")
      .select("category, description, default_priority")
      .eq("is_active", true)
      .order("sort_order"),
    profile.department_id
      ? supabase.from("departments").select("name").eq("id", profile.department_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return (
    <>
      <PageHeader
        title="New ticket"
        description="Tell us what's wrong — we'll route it to the right person."
      />
      <PageBody className="max-w-2xl">
        <NewTicketForm
          categories={categories ?? []}
          departmentName={department?.name ?? null}
        />
      </PageBody>
    </>
  );
}
