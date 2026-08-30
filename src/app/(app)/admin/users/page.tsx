import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { hasServiceRoleKey } from "@/lib/supabase/admin";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { UsersAdmin } from "@/components/admin/users-admin";

export const metadata: Metadata = { title: "People" };

export default async function AdminUsersPage() {
  const ctx = await requireAdmin();
  const supabase = await createClient();

  const [{ data: users }, { data: departments }, { data: settings }] = await Promise.all([
    supabase.from("profiles").select("*").order("full_name"),
    supabase.from("departments").select("id, name").eq("is_active", true).order("sort_order"),
    supabase.from("app_settings").select("invite_expiry_hours, allowed_email_domains").maybeSingle(),
  ]);

  return (
    <>
      <PageHeader
        title="People"
        description="Invite, deprovision and set roles. Accounts are never deleted."
      />
      <PageBody>
        <UsersAdmin
          users={users ?? []}
          departments={departments ?? []}
          inviteExpiryHours={settings?.invite_expiry_hours ?? 48}
          allowedDomains={settings?.allowed_email_domains ?? []}
          viewerId={ctx.userId}
          serviceKeyConfigured={hasServiceRoleKey()}
        />
      </PageBody>
    </>
  );
}
