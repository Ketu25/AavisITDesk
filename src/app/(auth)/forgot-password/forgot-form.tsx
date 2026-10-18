"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);

    const supabase = createClient();
    await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });

    // Always report success: whether an address has an account is not
    // something an unauthenticated caller should be able to probe.
    setLoading(false);
    setSent(true);
  }

  if (sent) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-lg border border-[rgb(16_185_129_/_0.3)] bg-[rgb(16_185_129_/_0.08)] px-3.5 py-3 text-[0.8125rem] leading-relaxed text-ink"
      >
        If <span className="font-medium">{email}</span> has an active account, a reset link is on
        its way. It expires shortly, so use it soon.
      </motion.div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="Email" htmlFor="email" required>
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
      <Button type="submit" variant="primary" size="lg" loading={loading} className="w-full">
        Email me a reset link
      </Button>
    </form>
  );
}
