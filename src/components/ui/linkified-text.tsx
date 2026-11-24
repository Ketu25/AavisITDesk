"use client";

import { useMemo } from "react";
import { Icons } from "@/components/shell/icons";
import { tokenize } from "@/lib/linkify";
import { cn } from "@/lib/utils";

const LINK =
  "font-medium text-accent underline decoration-[var(--accent-line)] underline-offset-2 " +
  "transition-colors hover:decoration-[var(--accent)] [overflow-wrap:anywhere]";

/**
 * Plain text with its links made live — a message or a ticket description as
 * someone typed it. React escapes every run, so nothing typed can become
 * markup; only the hrefs the linkifier rebuilt from parsed URLs are linked.
 *
 * Web links open in a new tab, so following one never loses a half-written
 * reply; `noopener` keeps the opened page from reaching back into this one.
 */
export function LinkifiedText({ text, className }: { text: string; className?: string }) {
  const tokens = useMemo(() => tokenize(text), [text]);

  return (
    <p className={cn("whitespace-pre-wrap break-words", className)}>
      {tokens.map((token, index) => {
        if (token.kind === "text") return token.text;

        if (token.kind === "email") {
          return (
            <a key={index} href={token.href} className={LINK}>
              {token.text}
            </a>
          );
        }

        if (token.meeting) {
          return (
            <a
              key={index}
              href={token.href}
              target="_blank"
              rel="noopener noreferrer"
              title={token.href}
              className={cn(
                "mx-0.5 inline-flex max-w-full items-center gap-1.5 rounded-lg border border-accent-line",
                "bg-surface px-2 py-0.5 align-middle text-[0.75rem] font-medium text-accent",
                "transition-colors hover:bg-accent-soft",
              )}
            >
              <Icons.video className="size-3.5 flex-none" />
              <span className="truncate">Join {token.meeting} meeting</span>
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          );
        }

        return (
          <a
            key={index}
            href={token.href}
            target="_blank"
            rel="noopener noreferrer"
            title={token.shortened ? token.href : undefined}
            className={LINK}
          >
            {token.text}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        );
      })}
    </p>
  );
}
