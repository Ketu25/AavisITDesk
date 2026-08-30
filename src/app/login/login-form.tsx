"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { cn } from "@/lib/utils";

export function LoginForm({
  notice,
  noticeTone = "error",
  next,
}: {
  notice?: string;
  noticeTone?: "error" | "success";
  next?: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });

    if (signInError) {
      setLoading(false);
      setError(
        signInError.message === "Invalid login credentials"
          ? "That email and password combination is not recognised."
          : signInError.message,
      );
      return;
    }

    // A disabled account can still authenticate; the server guard signs it
    // straight back out, so let the destination page make that call.
    router.push(next && next.startsWith("/") ? next : "/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {notice && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className={cn(
            "rounded-lg border px-3 py-2.5 text-[0.8125rem] leading-relaxed",
            noticeTone === "success"
              ? "border-[rgb(16_185_129_/_0.3)] bg-[rgb(16_185_129_/_0.08)] text-ink"
              : "border-[rgb(244_63_94_/_0.3)] bg-[rgb(244_63_94_/_0.08)] text-ink",
          )}
        >
          {notice}
        </motion.div>
      )}

      <Field label="Email" htmlFor="email" required>
        <Input
          id="email"
          type="email"
          autoComplete="username"
          required
          autoFocus
          placeholder="you@aavispharma.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>

      <Field label="Password" htmlFor="password" required error={error}>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>

      <Button type="submit" variant="primary" size="lg" loading={loading} className="w-full">
        Sign in
      </Button>

      <div className="text-center">
        <Link
          href="/forgot-password"
          className="text-[0.8125rem] text-ink-muted underline-offset-4 transition-colors hover:text-ink hover:underline"
        >
          Forgot your password?
        </Link>
      </div>
    </form>
  );
}
