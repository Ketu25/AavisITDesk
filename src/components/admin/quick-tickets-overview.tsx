import Link from "next/link";
import { Icons } from "@/components/shell/icons";
import { QuickIcon } from "@/components/quick-tickets/icon";
import { plural } from "./quick-tickets-shared";
import type { QuickGroup } from "@/lib/quick-tickets";

/**
 * Quick ticket setup as an agent sees it: the groups requesters can use, with
 * what is in each, read-only — and each one's QR labels a click away.
 * Changing them is an admin's job, and the page says so rather than showing
 * controls that would be refused.
 *
 * Server-rendered and static: nothing here needs the browser.
 */
export function QuickTicketsOverview({ groups, failed }: { groups: QuickGroup[]; failed: boolean }) {
  if (failed) {
    return (
      <div className="card flex flex-col items-center gap-3 px-4 py-10 text-center">
        <Icons.alert className="size-5 text-ink-faint" />
        <div>
          <p className="text-[0.875rem] font-medium text-ink">Couldn&apos;t load the quick tickets</p>
          <p className="mt-1 text-[0.8125rem] text-ink-muted">Check your connection, then try again.</p>
        </div>
        <a
          href="/admin/quick-tickets"
          className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-2.5 text-[0.8125rem] font-medium text-ink transition-colors hover:bg-surface-hover"
        >
          <Icons.refresh className="size-3.5" />
          Try again
        </a>
      </div>
    );
  }

  const issues = groups.reduce((sum, group) => sum + group.issues.length, 0);

  return (
    <div className="space-y-7">
      <div className="flex items-start gap-3 rounded-[14px] border border-line bg-surface px-4 py-3.5">
        <span className="flex size-8 flex-none items-center justify-center rounded-[9px] bg-accent-soft text-accent">
          <Icons.qr className="size-4" />
        </span>
        <div className="min-w-0 text-[0.8125rem] leading-relaxed text-ink-muted text-pretty">
          <p>
            <span className="font-medium text-ink">Stick a QR label where a problem happens</span> — on the
            printer, by the meeting-room screen. Scanning it with a phone opens that group&apos;s quick
            tickets, with where the label is already filled in.
          </p>
          <p className="mt-1 text-xs text-ink-faint">
            Only an admin can add or change groups and quick tickets.
          </p>
        </div>
      </div>

      <section aria-labelledby="quick-overview-groups" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="quick-overview-groups" className="eyebrow">
            Groups requesters see
          </h2>
          {groups.length > 0 && (
            <p className="text-xs text-ink-faint">
              {plural(groups.length, "group")} · {plural(issues, "quick ticket")}
            </p>
          )}
        </div>

        {groups.length === 0 ? (
          <div className="card px-4 py-10 text-center">
            <p className="text-[0.875rem] font-medium text-ink">No quick tickets are live</p>
            <p className="mx-auto mt-1 max-w-sm text-[0.8125rem] text-ink-muted text-pretty">
              Once an admin sets some up, their groups appear here, ready to label.
            </p>
          </div>
        ) : (
          // Sized by the room the grid actually gets, not the window: the
          // sidebar takes a different share at every breakpoint.
          <div className="@container">
            <ul className="grid grid-cols-1 gap-3 @xs:grid-cols-2 @2xl:grid-cols-3 @5xl:grid-cols-4">
              {groups.map((group) => (
                <li
                  key={group.id}
                  className="glyph-host flex min-w-0 flex-col rounded-[14px] border border-line bg-surface p-3.5 shadow-[var(--shadow-sm)] sm:p-4"
                >
                  <div className="flex items-start gap-3">
                    <span className="flex size-10 flex-none items-center justify-center rounded-[11px] border border-line bg-surface-sunk text-ink-muted">
                      <QuickIcon name={group.icon} className="size-[1.15rem]" />
                    </span>
                    <div className="min-w-0 flex-1 pt-0.5">
                      <h3 className="line-clamp-2 break-words text-[0.875rem] font-semibold leading-snug tracking-tight text-ink">
                        {group.name}
                      </h3>
                      {group.description && (
                        <p className="mt-0.5 line-clamp-2 break-words text-xs leading-relaxed text-ink-faint">
                          {group.description}
                        </p>
                      )}
                    </div>
                  </div>

                  <ul aria-label={`Quick tickets in ${group.name}`} className="mt-3 flex flex-wrap gap-1.5">
                    {group.issues.map((issue) => (
                      <li
                        key={issue.id}
                        className="max-w-full truncate rounded-md border border-line bg-surface-sunk px-1.5 py-0.5 text-[0.6875rem] text-ink-muted"
                      >
                        {issue.label}
                      </li>
                    ))}
                  </ul>

                  <div className="mt-auto flex items-center justify-between gap-2 pt-3.5">
                    <span className="text-[0.6875rem] text-ink-faint">
                      <span className="readout font-medium text-ink">{group.issues.length}</span>{" "}
                      {group.issues.length === 1 ? "quick ticket" : "quick tickets"}
                    </span>
                    <Link
                      href={`/admin/quick-tickets?labels=${group.id}`}
                      aria-label={`Print QR labels for ${group.name}`}
                      className="inline-flex h-8 items-center gap-1.5 rounded-[9px] border border-line-strong bg-surface px-2.5 text-xs font-medium text-ink transition-colors hover:border-accent-line hover:bg-accent-soft hover:text-accent"
                    >
                      <Icons.qr className="size-3.5" />
                      QR labels
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
