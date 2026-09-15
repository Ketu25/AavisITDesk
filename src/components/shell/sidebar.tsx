"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useRef } from "react";
import { Wordmark } from "./logo";
import { Icons } from "./icons";
import { ThemeToggle } from "./theme-toggle";
import { MOBILE_NAV_ID, useMobileNav } from "./mobile-nav";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { useEscape, useFocusTrap, useScrollLock } from "@/components/ui/use-overlay";
import { ROLE_META } from "@/lib/constants";
import { spring, stagger, transition } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { Profile } from "@/lib/database.types";

export type NavCounts = { myOpen: number; queueOpen: number; breached: number };

type Item = {
  href: string;
  label: string;
  icon: keyof typeof Icons;
  badge?: number;
  tone?: "accent" | "danger";
};

/**
 * Which copy of the nav a link belongs to. The desktop column and the mobile
 * drawer both render the same list, and `layoutId` is global — one shared id
 * across two mounted copies makes the active pill try to travel between them,
 * so each copy gets its own.
 */
type Scope = "desktop" | "mobile";

export function Sidebar({
  profile,
  departmentName,
  counts,
}: {
  profile: Profile;
  departmentName: string | null;
  counts: NavCounts;
}) {
  const pathname = usePathname();
  const { open, setOpen, close } = useMobileNav();
  const reduced = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);

  useEscape(open, close);
  useScrollLock(open);
  useFocusTrap(panelRef, open);

  const isAgent = profile.role === "agent" || profile.role === "admin";
  const isAdmin = profile.role === "admin";

  const groups: { label?: string; items: Item[] }[] = [
    {
      items: [
        { href: "/dashboard", label: "Overview", icon: "overview" },
        { href: "/tickets", label: "My tickets", icon: "ticket", badge: counts.myOpen },
      ],
    },
    ...(isAgent
      ? [
          {
            label: "Service desk",
            items: [
              {
                href: "/queue",
                label: "Queue",
                icon: "queue" as const,
                badge: counts.queueOpen,
                tone: counts.breached > 0 ? ("danger" as const) : undefined,
              },
              { href: "/reports", label: "Reports", icon: "reports" as const },
            ],
          },
        ]
      : []),
    ...(isAdmin
      ? [
          {
            label: "Administration",
            items: [
              { href: "/admin/users", label: "People", icon: "people" as const },
              { href: "/admin/departments", label: "Departments", icon: "building" as const },
              { href: "/admin/sla", label: "SLA rules", icon: "clock" as const },
              { href: "/admin/routing", label: "Routing", icon: "route" as const },
              { href: "/admin/settings", label: "Settings", icon: "settings" as const },
            ],
          },
        ]
      : []),
  ];

  /**
   * On touch the rows are the primary way around the app and sit under a
   * thumb, so they get the 44px minimum. On a pointer they tighten back up —
   * a mouse does not need the room, and the density is part of how the nav
   * reads as an instrument panel rather than a phone menu.
   */
  const nav = (scope: Scope) => (
    <>
      <div className="flex items-center justify-between px-3 pb-1 pt-4">
        <Link href="/dashboard" onClick={close} className="rounded-md">
          <Wordmark />
        </Link>
        <div className="flex items-center gap-0.5">
          <ThemeToggle />
          {scope === "mobile" && (
            <button
              type="button"
              onClick={close}
              aria-label="Close navigation"
              className={cn(
                "flex size-11 items-center justify-center rounded-[11px] text-ink-muted",
                "transition-colors duration-150 hover:bg-surface-hover hover:text-ink lg:hidden",
              )}
            >
              <svg viewBox="0 0 16 16" className="size-4" fill="none" aria-hidden>
                <path
                  d="m4 4 8 8m0-8-8 8"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className="px-3 py-3">
        <motion.div whileTap={{ scale: 0.98 }} transition={spring.snappy}>
          <Link
            href="/tickets/new"
            onClick={close}
            className={cn(
              "group flex h-11 w-full items-center justify-center gap-2 rounded-[10px] lg:h-9",
              "bg-accent text-[0.8125rem] font-medium text-[var(--accent-ink)]",
              "shadow-[var(--shadow-sm)] transition-[filter] duration-150 hover:brightness-110",
            )}
          >
            <Icons.plus className="size-4 transition-transform duration-300 group-hover:rotate-90" />
            New ticket
          </Link>
        </motion.div>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-2 pb-4">
        {groups.map((group, groupIndex) => (
          <div key={groupIndex}>
            {group.label && (
              <p className="px-3 pb-1.5 pt-1 text-[0.6875rem] font-semibold uppercase tracking-wider text-ink-faint">
                {group.label}
              </p>
            )}
            <ul className="space-y-0.5">
              {group.items.map((item, itemIndex) => {
                const Icon = Icons[item.icon];
                const active =
                  pathname === item.href ||
                  (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`));

                const row = (
                  <Link
                    href={item.href}
                    onClick={close}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "relative flex min-h-11 items-center gap-2.5 rounded-[9px] px-3 lg:min-h-0 lg:py-[7px]",
                      "text-[0.8125rem] font-medium transition-colors duration-150",
                      active ? "text-ink" : "text-ink-muted hover:bg-surface-hover hover:text-ink",
                    )}
                  >
                    {active && (
                      <motion.span
                        aria-hidden
                        layoutId={`nav-active-${scope}`}
                        transition={{ type: "spring", stiffness: 460, damping: 38 }}
                        className="absolute inset-0 -z-10 rounded-[9px] border border-line bg-surface"
                      />
                    )}
                    <Icon className={cn("size-[1.05rem] flex-none", active && "text-accent")} />
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.badge ? (
                      <motion.span
                        key={item.badge}
                        initial={reduced ? false : { scale: 0.7, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={spring.snappy}
                        className={cn(
                          "tabular rounded-md px-1.5 py-0.5 text-[0.6875rem] font-semibold",
                          item.tone === "danger"
                            ? "bg-[rgb(244_63_94_/_0.16)] text-[#be123c] dark:text-[#fb7185]"
                            : "bg-surface-sunk text-ink-muted",
                        )}
                      >
                        {item.badge > 99 ? "99+" : item.badge}
                      </motion.span>
                    ) : null}
                  </Link>
                );

                // The drawer deals its rows in rather than appearing whole —
                // it is a surface that just arrived, so the eye gets an order
                // to read it in. The static column never does this.
                return (
                  <li key={item.href}>
                    {scope === "mobile" && !reduced ? (
                      <motion.div
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{
                          ...transition.base,
                          delay: 0.06 + stagger(groupIndex * 2 + itemIndex, 0.022),
                        }}
                      >
                        {row}
                      </motion.div>
                    ) : (
                      row
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-line p-3">
        <Link
          href="/profile"
          onClick={close}
          className="flex items-center gap-2.5 rounded-[10px] p-1.5 transition-colors hover:bg-surface-hover"
        >
          <Avatar name={profile.full_name} id={profile.id} size="md" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[0.8125rem] font-medium text-ink">{profile.full_name}</p>
            <p className="truncate text-[0.6875rem] text-ink-faint">
              {departmentName ?? "No department"}
            </p>
          </div>
          <Badge tone={ROLE_META[profile.role].tone} dot={false}>
            {ROLE_META[profile.role].label}
          </Badge>
        </Link>
      </div>
    </>
  );

  return (
    <>
      {/* Sticky full-height column: the nav must stay put however long
          the page content grows. The trigger for the mobile twin lives in
          <PageHeader>, not here. */}
      <aside className="sticky top-0 hidden h-dvh w-[15.5rem] flex-none flex-col border-r border-line bg-canvas-raised lg:flex">
        {nav("desktop")}
      </aside>

      <AnimatePresence>
        {open && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={transition.fast}
              onClick={() => setOpen(false)}
              className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
            />
            <motion.div
              ref={panelRef}
              id={MOBILE_NAV_ID}
              role="dialog"
              aria-modal="true"
              aria-label="Navigation"
              tabIndex={-1}
              initial={reduced ? { opacity: 0 } : { x: "-100%" }}
              animate={reduced ? { opacity: 1 } : { x: 0 }}
              exit={reduced ? { opacity: 0 } : { x: "-100%" }}
              transition={reduced ? transition.fast : { type: "spring", stiffness: 420, damping: 40 }}
              className={cn(
                "relative flex h-full w-[17rem] max-w-[85vw] flex-col outline-none",
                "border-r border-line bg-canvas-raised shadow-[var(--shadow-lg)]",
              )}
            >
              {nav("mobile")}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
