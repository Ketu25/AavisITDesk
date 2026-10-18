"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { ApiClientError } from "@/lib/api";

function sameOrder(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/**
 * An order the admin changes one step at a time, saved as a whole list.
 *
 * A move shows at once and stays until the server's order catches up — the
 * page also refreshes for unrelated reasons, and snapping back to a stale
 * order mid-save would look like the move was lost. Saves are serialised and
 * always send the newest order, so quick successive moves cannot land out of
 * sequence. If the server's order changes underneath while nothing is being
 * saved (another admin), the server wins. The same rules as the routing list.
 */
export function useSavedOrder(
  serverIds: string[],
  serverKey: string,
  save: (ids: string[]) => Promise<unknown>,
) {
  const router = useRouter();
  const { push } = useToast();
  const [draft, setDraft] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [settledKey, setSettledKey] = useState<string | null>(null);
  const inFlight = useRef(false);
  const queued = useRef<string[] | null>(null);

  const known = new Set(serverIds);
  const orderIds = draft
    ? [...draft.filter((id) => known.has(id)), ...serverIds.filter((id) => !draft.includes(id))]
    : serverIds;

  if (draft && !saving) {
    if (sameOrder(draft, serverIds)) {
      setDraft(null);
      setSettledKey(null);
    } else if (settledKey === null) {
      setSettledKey(serverKey);
    } else if (settledKey !== serverKey) {
      setDraft(null);
      setSettledKey(null);
    }
  }

  async function persist(ids: string[]) {
    setSettledKey(null);
    queued.current = ids;
    if (inFlight.current) return;

    inFlight.current = true;
    setSaving(true);
    try {
      while (queued.current) {
        const next = queued.current;
        queued.current = null;
        await save(next);
      }
      push({ tone: "success", title: "Order saved" });
    } catch (error) {
      queued.current = null;
      setDraft(null);
      push({
        tone: "error",
        title: "The new order wasn't saved",
        description: error instanceof ApiClientError ? error.message : "Please try again.",
      });
    } finally {
      inFlight.current = false;
      setSaving(false);
      router.refresh();
    }
  }

  /** Swaps `id` with its neighbour; returns the new order, or null at an end. */
  function move(id: string, delta: -1 | 1) {
    const ids = [...orderIds];
    const from = ids.indexOf(id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return null;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    setDraft(ids);
    void persist(ids);
    return ids;
  }

  return { orderIds, move };
}
