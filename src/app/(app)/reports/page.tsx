import type { Metadata } from "next";
import { requireAgent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { ReportsView } from "@/components/reports/reports-view";
import type { ReportSummary } from "@/lib/report-types";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsPage() {
  await requireAgent();
  const supabase = await createClient();

  // Server Component: renders once per request, so reading the clock here
  // is deterministic for that render. The purity rule targets client renders.
  // eslint-disable-next-line react-hooks/purity
  const from = new Date(Date.now() - 30 * 86400000).toISOString();
  const { data, error } = await supabase.rpc("report_summary", {
    p_from: from,
    p_to: new Date().toISOString(),
  });

  return (
    <>
      <PageHeader
        title="Reports"
        description="Volume, resolution time and where the load actually sits."
      />
      <PageBody>
        {error ? (
          <div className="card p-5 text-[0.8125rem] text-ink-muted">
            Reporting is unavailable: {error.message}
          </div>
        ) : (
          <ReportsView initial={data as unknown as ReportSummary} initialDays={30} />
        )}
      </PageBody>
    </>
  );
}
