"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Icons } from "@/components/shell/icons";
import { absoluteTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export type IssuedCredential = {
  email: string;
  full_name?: string;
  temp_password: string;
  expires_at?: string;
};

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);

  async function copy(value: string, key: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1600);
    } catch {
      // Clipboard blocked (insecure origin or denied permission): the value is
      // on screen and selectable, so this is a convenience, not the only path.
    }
  }

  return { copied, copy };
}

/**
 * Temporary passwords are shown exactly once — they are never stored in
 * plaintext, so a lost one is reissued rather than recovered. Everything here
 * is built around getting them out of this screen and to people quickly.
 */
export function CredentialsPanel({
  credentials,
  activationUrl,
  onDone,
}: {
  credentials: IssuedCredential[];
  activationUrl: string;
  onDone?: () => void;
}) {
  const { copied, copy } = useCopy();

  const asTable = credentials
    .map((c) => [c.full_name ?? "", c.email, c.temp_password].join("\t"))
    .join("\n");

  function downloadCsv() {
    const header = "name,email,temporary_password,activation_url\n";
    const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const body = credentials
      .map((c) =>
        [escape(c.full_name ?? ""), escape(c.email), escape(c.temp_password), escape(activationUrl)].join(","),
      )
      .join("\n");

    const blob = new Blob([header + body], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `aavis-it-desk-credentials-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  const expiry = credentials.find((c) => c.expires_at)?.expires_at;

  return (
    <div className="space-y-4">
      <motion.div
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-lg border border-[rgb(245_158_11_/_0.4)] bg-[rgb(245_158_11_/_0.07)] px-3.5 py-3"
      >
        <p className="flex items-center gap-1.5 text-[0.875rem] font-medium text-ink">
          <Icons.alert className="size-4" />
          Copy these now — they are not shown again
        </p>
        <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-ink-muted">
          Passwords are never stored in readable form. If one is lost, issue a new
          one from the People list rather than looking it up.
          {expiry && (
            <>
              {" "}
              These expire <span className="font-medium text-ink">{absoluteTime(expiry)}</span>.
            </>
          )}
        </p>
      </motion.div>

      <div>
        <p className="mb-1.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-ink-faint">
          Send people this link
        </p>
        <div className="flex gap-2">
          <code className="min-w-0 flex-1 truncate rounded-lg border border-line bg-surface-sunk px-2.5 py-2 font-mono text-[0.75rem] text-ink">
            {activationUrl}
          </code>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => copy(activationUrl, "url")}
            icon={copied === "url" ? <Icons.check className="size-3.5" /> : undefined}
          >
            {copied === "url" ? "Copied" : "Copy"}
          </Button>
        </div>
      </div>

      <div className="max-h-72 overflow-auto rounded-xl border border-line">
        <table className="w-full text-[0.8125rem]">
          <thead className="sticky top-0 bg-canvas-raised">
            <tr className="border-b border-line text-left text-[0.6875rem] uppercase tracking-wider text-ink-faint">
              <th className="px-3 py-2 font-semibold">Person</th>
              <th className="px-3 py-2 font-semibold">Temporary password</th>
              <th className="w-16 px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {credentials.map((c) => (
              <tr key={c.email} className="border-b border-line last:border-b-0">
                <td className="px-3 py-2">
                  {c.full_name && <div className="font-medium text-ink">{c.full_name}</div>}
                  <div className="font-mono text-xs text-ink-muted">{c.email}</div>
                </td>
                <td className="px-3 py-2">
                  <code className="select-all rounded bg-surface-sunk px-1.5 py-1 font-mono text-[0.8125rem] text-ink">
                    {c.temp_password}
                  </code>
                </td>
                <td className="px-3 py-2 text-right">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => copy(`${c.email}\n${c.temp_password}\n${activationUrl}`, c.email)}
                  >
                    {copied === c.email ? "Copied" : "Copy"}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={cn("flex flex-wrap justify-end gap-2 border-t border-line pt-4")}>
        <Button variant="ghost" onClick={() => copy(asTable, "all")}>
          {copied === "all" ? "Copied" : "Copy all"}
        </Button>
        <Button variant="secondary" onClick={downloadCsv}>
          Download CSV
        </Button>
        {onDone && (
          <Button variant="primary" onClick={onDone}>
            Done
          </Button>
        )}
      </div>
    </div>
  );
}
