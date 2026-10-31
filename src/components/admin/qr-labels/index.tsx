"use client";

import dynamic from "next/dynamic";
import { Spinner } from "@/components/ui/spinner";

/**
 * The QR label printer, loaded in the browser only. It draws nothing worth
 * server-rendering — the codes, the sheets and the fitting all need the
 * browser — and the server render is bundled into the Cloudflare Worker,
 * already close to its size limit, which the QR encoder would only add to.
 */
export const QrLabels = dynamic(() => import("./studio").then((m) => m.QrLabelsStudio), {
  ssr: false,
  loading: () => (
    <div className="card flex items-center justify-center gap-2.5 px-4 py-16 text-[0.8125rem] text-ink-muted">
      <Spinner className="size-4" />
      Getting the label printer ready…
    </div>
  ),
});
