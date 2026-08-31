"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { motion } from "motion/react";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

type State = "checking" | "needs_click" | "verifying" | "ready" | "invalid";

/**
 * Email links are single-use, and corporate mail security (Microsoft Safe
 * Links and similar) fetches every URL in a message to scan it. If the link
 * verifies on page load, the scanner burns the token and the real recipient
 * gets a dead link.
 *
 * So the token is never spent by merely opening the page: it is spent only
 * when a human presses the button. A scanner's GET renders this and stops.
 */
export function TokenGate({
  type,
  actionLabel,
  intro,
  children,
}: {
  type: EmailOtpType;
  actionLabel: string;
  intro: string;
  children: React.ReactNode;
}) {
  const params = useSearchParams();
  const tokenHash = params.get("token_hash");
  const [state, setState] = useState<State>("checking");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    // A session may already exist: either the older redirect flow ran, or the
    // tokens arrived in the URL fragment and the browser client consumed them.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!cancelled && session) setState("ready");
    });

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (data.session) setState("ready");
      else if (tokenHash) setState("needs_click");
      else {
        setTimeout(() => {
          if (!cancelled) setState((s) => (s === "checking" ? "invalid" : s));
        }, 1800);
      }
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [tokenHash]);

  const verify = useCallback(async () => {
    if (!tokenHash) return;
    setState("verifying");
    setError(null);

    const supabase = createClient();
    const { error: verifyError } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    });

    if (verifyError) {
      setError(verifyError.message);
      setState("invalid");
      return;
    }
    setState("ready");
  }, [tokenHash, type]);

  if (state === "checking") {
    return (
      <div className="flex items-center gap-2.5 py-6 text-sm text-ink-muted">
        <Spinner />
        Checking your link…
      </div>
    );
  }

  if (state === "needs_click" || state === "verifying") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-4"
      >
        <p className="text-[0.8125rem] leading-relaxed text-ink-muted text-pretty">{intro}</p>
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          loading={state === "verifying"}
          onClick={verify}
        >
          {actionLabel}
        </Button>
        <p className="text-xs leading-relaxed text-ink-faint">
          This link works once. Pressing the button is what uses it, so a mail
          scanner opening the page in the background cannot spend it first.
        </p>
      </motion.div>
    );
  }

  if (state === "invalid") {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-[rgb(244_63_94_/_0.3)] bg-[rgb(244_63_94_/_0.08)] px-3 py-2.5 text-[0.8125rem] leading-relaxed text-ink">
          {error ?? "This link is invalid or has expired. Links are single-use and time limited."}
        </div>
        <p className="text-[0.8125rem] leading-relaxed text-ink-muted">
          Ask an administrator to send a new one — your account and its history are untouched.
        </p>
        <Link
          href="/login"
          className="inline-block text-[0.8125rem] text-accent underline-offset-4 hover:underline"
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}
