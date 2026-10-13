"use client";

import { Icons } from "@/components/shell/icons";
import { isQuickIcon } from "@/lib/quick-tickets";

/** A group's icon by name. Anything outside the set falls back to the general one. */
export function QuickIcon({ name, className }: { name: string; className?: string }) {
  const Icon = isQuickIcon(name) ? Icons[name] : Icons.bolt;
  return <Icon className={className} />;
}
