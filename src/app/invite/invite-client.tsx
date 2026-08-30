"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { SetPasswordForm } from "@/components/shell/set-password-form";
import { Spinner } from "@/components/ui/spinner";

type State = "checking" | "ready" | "invalid";

/**
 * Supabase invite links can arrive two ways: the session may already be set by
 * /auth/callback, or the tokens may still be sitting in the URL fragment. The
 * browser client consumes the fragment on construction, so we just wait for it.
 */
export function InviteClient() {
  const [state, setState] = useState<State>("checking");

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!cancelled && session) setState("ready");
    });

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (data.session) setState("ready");
      else setTimeout(() => !cancelled && setState((s) => (s === "checking" ? "invalid" : s)), 1800);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  if (state === "checking") {
    return (
      <div className="flex items-center gap-2.5 py-6 text-sm text-ink-muted">
        <Spinner />
        Verifying your invite link…
      </div>
    );
  }

  if (state === "invalid") {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-[rgb(244_63_94_/_0.3)] bg-[rgb(244_63_94_/_0.08)] px-3 py-2.5 text-[0.8125rem] leading-relaxed text-ink">
          This invite link is invalid or has expired. Invite links are single-use and time
          limited.
        </div>
        <p className="text-[0.8125rem] leading-relaxed text-ink-muted">
          Ask an administrator to resend your invite — your account is still there, so nothing is
          lost.
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

  return <SetPasswordForm submitLabel="Activate my account" activateAfter />;
}
