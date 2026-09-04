import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Sidebar, type NavCounts } from "@/components/shell/sidebar";
import { AppBackdrop } from "@/components/shell/app-backdrop";
import { RealtimeRefresh } from "@/components/shell/realtime-refresh";
import { OPEN_STATUSES } from "@/lib/constants";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile, isAgent } = await requireUser();
  const supabase = await createClient();

  const nowIso = new Date().toISOString();

  const [departmentResult, myOpenResult, queueOpenResult, breachedResult] = await Promise.all([
    profile.department_id
      ? supabase.from("departments").select("name").eq("id", profile.department_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("tickets")
      .select("id", { count: "exact", head: true })
      .eq("created_by", profile.id)
      .in("status", OPEN_STATUSES),
    isAgent
      ? supabase.from("tickets").select("id", { count: "exact", head: true }).in("status", OPEN_STATUSES)
      : Promise.resolve({ count: 0 }),
    isAgent
      ? supabase
          .from("tickets")
          .select("id", { count: "exact", head: true })
          .in("status", OPEN_STATUSES)
          .lt("sla_due_at", nowIso)
          .is("sla_paused_at", null)
      : Promise.resolve({ count: 0 }),
  ]);

  const counts: NavCounts = {
    myOpen: myOpenResult.count ?? 0,
    queueOpen: queueOpenResult.count ?? 0,
    breached: breachedResult.count ?? 0,
  };

  return (
    <div className="flex min-h-dvh">
      <Sidebar
        profile={profile}
        departmentName={departmentResult.data?.name ?? null}
        counts={counts}
      />
      <AppBackdrop alert={counts.breached} />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      <RealtimeRefresh />
    </div>
  );
}
