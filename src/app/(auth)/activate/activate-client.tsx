"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

const MIN_LENGTH = 10;

type Stage = "checking" | "credentials" | "choose" | "expired";

function strengthOf(password: string) {
  let score = 0;
  if (password.length >= MIN_LENGTH) score++;
  if (password.length >= 14) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^\w\s]/.test(password)) score++;
  return Math.min(score, 4);
}

const STRENGTH = [
  { label: "Too short", tone: "bg-[#f43f5e]" },
  { label: "Weak", tone: "bg-[#f97316]" },
  { label: "Fair", tone: "bg-[#f59e0b]" },
  { label: "Good", tone: "bg-[#10b981]" },
  { label: "Strong", tone: "bg-[#10b981]" },
];

export function ActivateClient() {
  const router = useRouter();

  const [stage, setStage] = useState<Stage>("checking");
  const [email, setEmail] = useState("");
  const [tempPassword, setTempPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const score = useMemo(() => strengthOf(password), [password]);

  // A pending session (redirected here by the app guard) skips straight to
  // choosing a password — it has already proven it holds the temporary one.
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;

      if (!data.session) {
        setStage("credentials");
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("must_change_password, temp_password_expires_at")
        .eq("id", data.session.user.id)
        .maybeSingle();

      if (cancelled) return;

      if (profile && isExpired(profile.temp_password_expires_at)) {
        await supabase.auth.signOut();
        setStage("expired");
        return;
      }

      setStage(profile?.must_change_password ? "choose" : "credentials");
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  function isExpired(expiresAt: string | null | undefined) {
    return Boolean(expiresAt && new Date(expiresAt).getTime() < Date.now());
  }

  function validateNewPassword(against?: string) {
    if (password.length < MIN_LENGTH) return `Use at least ${MIN_LENGTH} characters.`;
    if (password !== confirm) return "Those two passwords do not match.";
    if (against && password === against) {
      return "Choose something different from the temporary password.";
    }
    return null;
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const supabase = createClient();

    // Stage 1: exchange the temporary password for a session.
    if (stage === "credentials") {
      const problem = validateNewPassword(tempPassword);
      if (problem) {
        setError(problem);
        return;
      }

      setLoading(true);
      const { data: signIn, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password: tempPassword,
      });

      if (signInError || !signIn.session) {
        setLoading(false);
        setError("That email and temporary password do not match.");
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("must_change_password, temp_password_expires_at")
        .eq("id", signIn.session.user.id)
        .maybeSingle();

      if (profile && isExpired(profile.temp_password_expires_at)) {
        await supabase.auth.signOut();
        setLoading(false);
        setStage("expired");
        return;
      }
    } else {
      const problem = validateNewPassword();
      if (problem) {
        setError(problem);
        return;
      }
      setLoading(true);
    }

    // Stage 2: replace it, then ask the server to confirm the swap. The server
    // compares the stored password hash against the one recorded when the
    // temporary password was issued, so activation cannot be faked.
    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      setLoading(false);
      setError(updateError.message);
      return;
    }

    const activated = await fetch("/api/auth/activate", { method: "POST" });
    if (!activated.ok) {
      const payload = await activated.json().catch(() => ({}));
      setLoading(false);
      setError(payload.error ?? "Your password changed, but the account could not be activated.");
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  if (stage === "checking") {
    return (
      <div className="flex items-center gap-2.5 py-6 text-sm text-ink-muted">
        <Spinner />
        Checking your account…
      </div>
    );
  }

  if (stage === "expired") {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-[rgb(244_63_94_/_0.3)] bg-[rgb(244_63_94_/_0.08)] px-3 py-2.5 text-[0.8125rem] leading-relaxed text-ink">
          That temporary password has expired.
        </div>
        <p className="text-[0.8125rem] leading-relaxed text-ink-muted">
          Ask IT to issue a new one — your account and any ticket history are
          untouched.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {stage === "credentials" && (
        <>
          <Field label="Work email" htmlFor="email" required>
            <Input
              id="email"
              type="email"
              required
              autoFocus
              autoComplete="username"
              placeholder="you@aavispharma.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>

          <Field
            label="Temporary password"
            htmlFor="temp"
            required
            hint="The one IT gave you. You will not need it again after this."
          >
            <Input
              id="temp"
              type="password"
              required
              autoComplete="one-time-code"
              placeholder="Paste it here"
              value={tempPassword}
              onChange={(e) => setTempPassword(e.target.value)}
            />
          </Field>

          <div className="border-t border-line pt-4" />
        </>
      )}

      <Field label="Choose your password" htmlFor="password" required>
        <Input
          id="password"
          type="password"
          required
          autoFocus={stage === "choose"}
          autoComplete="new-password"
          placeholder="At least 10 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {password.length > 0 && (
          <div className="flex items-center gap-2 pt-1">
            <div className="flex h-1 flex-1 gap-1">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex-1 overflow-hidden rounded-full bg-surface-sunk">
                  <motion.div
                    initial={false}
                    animate={{ scaleX: i < score ? 1 : 0 }}
                    style={{ originX: 0 }}
                    transition={{ duration: 0.25 }}
                    className={cn("h-full w-full", STRENGTH[score].tone)}
                  />
                </div>
              ))}
            </div>
            <span className="w-14 text-right text-[0.6875rem] text-ink-faint">
              {STRENGTH[score].label}
            </span>
          </div>
        )}
      </Field>

      <Field label="Confirm password" htmlFor="confirm" required error={error}>
        <Input
          id="confirm"
          type="password"
          required
          autoComplete="new-password"
          placeholder="Type it again"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </Field>

      <Button type="submit" variant="primary" size="lg" loading={loading} className="w-full">
        Activate my account
      </Button>
    </form>
  );
}
