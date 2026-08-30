"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Keeps every open page honest: any ticket or comment write anywhere in the
 * org re-renders the current server components. Debounced so a burst of
 * updates costs one refresh, not ten.
 */
export function RealtimeRefresh() {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const supabase = createClient();

    const schedule = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 350);
    };

    const channel = supabase
      .channel("aavis-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "tickets" }, schedule)
      .on("postgres_changes", { event: "*", schema: "public", table: "ticket_comments" }, schedule)
      .subscribe();

    return () => {
      if (timer.current) clearTimeout(timer.current);
      supabase.removeChannel(channel);
    };
  }, [router]);

  return null;
}
