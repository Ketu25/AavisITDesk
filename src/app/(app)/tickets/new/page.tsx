import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { NewTicketPageForm } from "@/components/tickets/new-ticket";

export const metadata: Metadata = { title: "New ticket" };

/**
 * Every "New ticket" control in the app opens a dialog over the current page.
 * This route stays for bookmarks and older links, and renders the same steps
 * as a page. The department comes from the layout, through the provider.
 */
export default async function NewTicketPage() {
  const supabase = await createClient();

  const { data: categories, error } = await supabase
    .from("routing_rules")
    .select("category, description, default_priority")
    .eq("is_active", true)
    .order("sort_order")
    .order("category");

  return (
    <>
      <PageHeader
        title="New ticket"
        description="Tell us what's wrong — we'll route it to the right person."
      />
      <PageBody className="max-w-2xl">
        <NewTicketPageForm categories={error ? null : (categories ?? [])} failed={Boolean(error)} />
      </PageBody>
    </>
  );
}
