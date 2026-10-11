"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useIsClient } from "@/components/motion";
import { NEW_TICKET_PAGE_ID, type Category } from "./context";
import { NewTicketWizard } from "./wizard";

/**
 * /tickets/new as a page: the same steps as the dialog, in a card, for
 * bookmarks and for links written before the dialog existed.
 *
 * Rendered on the client only. The draft lives in sessionStorage, which the
 * server cannot see; rendering the empty form there and then swapping in a
 * restored draft would visibly jump a step on load. The skeleton holds the
 * space for the moment it takes to hydrate.
 */
export function NewTicketPageForm({
  categories,
  failed,
}: {
  categories: Category[] | null;
  failed: boolean;
}) {
  const router = useRouter();
  const isClient = useIsClient();
  const [refreshing, startRefresh] = useTransition();

  return (
    <div
      id={NEW_TICKET_PAGE_ID}
      tabIndex={-1}
      // Clears the sticky page header when brought into view.
      className="card scroll-mt-20 overflow-hidden outline-none"
    >
      {isClient ? (
        <NewTicketWizard
          variant="page"
          categories={categories}
          categoriesFailed={failed}
          categoriesLoading={refreshing}
          onRetryCategories={() => startRefresh(() => router.refresh())}
        />
      ) : (
        <WizardSkeleton />
      )}
    </div>
  );
}

function WizardSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading the form">
      <div className="space-y-2.5 px-5 pb-3 pt-4">
        <div className="shimmer h-2.5 w-36 rounded bg-surface-sunk" />
        <div className="shimmer h-4 w-48 rounded bg-surface-sunk" />
        <div className="shimmer h-3 w-72 max-w-full rounded bg-surface-sunk" />
        <div className="grid grid-cols-3 gap-2 pt-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[3px] rounded-full bg-surface-sunk" />
          ))}
        </div>
      </div>
      <div className="grid gap-2 border-t border-line px-5 py-4 sm:grid-cols-2">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="shimmer h-[4.25rem] rounded-[12px] border border-line bg-surface" />
        ))}
      </div>
      <div className="h-[3.75rem] border-t border-line" />
    </div>
  );
}
