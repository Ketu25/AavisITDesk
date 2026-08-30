import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { ProfileView } from "@/components/shell/profile-view";

export const metadata: Metadata = { title: "Your profile" };

export default async function ProfilePage() {
  const { profile } = await requireUser();
  const supabase = await createClient();

  const { data: department } = profile.department_id
    ? await supabase.from("departments").select("name").eq("id", profile.department_id).maybeSingle()
    : { data: null };

  return (
    <>
      <PageHeader title="Your profile" description="What the rest of the desk sees." />
      <PageBody className="max-w-xl">
        <ProfileView profile={profile} departmentName={department?.name ?? null} />
      </PageBody>
    </>
  );
}
