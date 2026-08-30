"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Wordmark } from "./logo";
import { Icons } from "./icons";
import { ThemeToggle } from "./theme-toggle";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ROLE_META } from "@/lib/constants";
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
  const [mobileOpen, setMobileOpen] = useState(false);

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

  const nav = (
    <>
      <div className="flex items-center justify-between px-3 pb-1 pt-4">
        <Link href="/dashboard" onClick={() => setMobileOpen(false)}>
          <Wordmark />
        </Link>
        <ThemeToggle />
      </div>

      <div className="px-3 py-3">
        <Link
          href="/tickets/new"
          onClick={() => setMobileOpen(false)}
          className={cn(
            "group flex h-9 w-full items-center justify-center gap-2 rounded-[10px]",
            "bg-accent text-[0.8125rem] font-medium text-[var(--accent-ink)]",
            "shadow-[var(--shadow-sm)] transition-[filter,transform] duration-150",
            "hover:brightness-110 active:scale-[0.98]",
          )}
        >
          <Icons.plus className="size-4 transition-transform duration-200 group-hover:rotate-90" />
          New ticket
        </Link>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-2 pb-4">
        {groups.map((group, gi) => (
          <div key={gi}>
            {group.label && (
              <p className="px-3 pb-1.5 pt-1 text-[0.6875rem] font-semibold uppercase tracking-wider text-ink-faint">
                {group.label}
              </p>
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = Icons[item.icon];
                const active =
                  pathname === item.href ||
                  (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`));

                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={() => setMobileOpen(false)}
                      className={cn(
                        "relative flex items-center gap-2.5 rounded-[9px] px-3 py-[7px]",
                        "text-[0.8125rem] font-medium transition-colors duration-150",
                        active
                          ? "text-ink"
                          : "text-ink-muted hover:bg-surface-hover hover:text-ink",
                      )}
                    >
                      {active && (
                        <motion.span
                          layoutId="nav-active"
                          transition={{ type: "spring", stiffness: 460, damping: 38 }}
                          className="absolute inset-0 -z-10 rounded-[9px] border border-line bg-surface"
                        />
                      )}
                      <Icon className={cn("size-[1.05rem] flex-none", active && "text-accent")} />
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.badge ? (
                        <span
                          className={cn(
                            "tabular rounded-md px-1.5 py-0.5 text-[0.6875rem] font-semibold",
                            item.tone === "danger"
                              ? "bg-[rgb(244_63_94_/_0.16)] text-[#e11d48] dark:text-[#fb7185]"
                              : "bg-surface-sunk text-ink-muted",
                          )}
                        >
                          {item.badge > 99 ? "99+" : item.badge}
                        </span>
                      ) : null}
                    </Link>
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
          onClick={() => setMobileOpen(false)}
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
      {/* Mobile trigger */}
      <button
        onClick={() => setMobileOpen(true)}
        aria-label="Open navigation"
        className="fixed left-3 top-3 z-40 flex size-9 items-center justify-center rounded-lg border border-line bg-canvas-raised text-ink-muted shadow-[var(--shadow-sm)] lg:hidden"
      >
        <svg viewBox="0 0 20 20" className="size-4" fill="none">
          <path d="M3 6h14M3 10h14M3 14h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>

      {/* Sticky full-height column: the nav must stay put however long
          the page content grows. */}
      <aside className="sticky top-0 hidden h-dvh w-[15.5rem] flex-none flex-col border-r border-line bg-canvas-raised lg:flex">
        {nav}
      </aside>

      <AnimatePresence>
        {mobileOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileOpen(false)}
              className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
            />
            <motion.aside
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 420, damping: 40 }}
              className="relative flex h-full w-[16rem] flex-col border-r border-line bg-canvas-raised"
            >
              {nav}
            </motion.aside>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
