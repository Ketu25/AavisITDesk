"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { cn } from "@/lib/utils";

const MIN_LENGTH = 10;

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

export function SetPasswordForm({ submitLabel }: { submitLabel: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const score = useMemo(() => strengthOf(password), [password]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (password.length < MIN_LENGTH) {
      setError(`Use at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("Those two passwords do not match.");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    // Clearing the marker in the same call is what tells the auth trigger this
    // password was chosen by the holder, not issued by an admin.
    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      setLoading(false);
      setError(updateError.message);
      return;
    }

    // The server verifies the password hash actually changed before granting
    // access, so this is the step that turns a pending account into a live one.
    await fetch("/api/auth/activate", { method: "POST" }).catch(() => {});

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="New password" htmlFor="password" required>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          required
          autoFocus
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
          autoComplete="new-password"
          required
          placeholder="Type it again"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </Field>

      <Button type="submit" variant="primary" size="lg" loading={loading} className="w-full">
        {submitLabel}
      </Button>
    </form>
  );
}
