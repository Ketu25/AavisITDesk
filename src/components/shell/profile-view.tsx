"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import { ROLE_META } from "@/lib/constants";
import { absoluteTime } from "@/lib/format";
import type { Profile } from "@/lib/database.types";
import { StaggerChildren } from "@/components/motion";

export function ProfileView({
  profile,
  departmentName,
}: {
  profile: Profile;
  departmentName: string | null;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [name, setName] = useState(profile.full_name);
  const [busy, setBusy] = useState<string | null>(null);

  async function saveName(event: React.FormEvent) {
    event.preventDefault();
    if (name.trim() === profile.full_name || !name.trim()) return;

    setBusy("name");
    // RLS lets you update your own row; a trigger blocks everything except
    // the display name, so this cannot escalate a role.
    const supabase = createClient();
    const { error } = await supabase
      .from("profiles")
      .update({ full_name: name.trim() })
      .eq("id", profile.id);

    setBusy(null);
    if (error) {
      push({ tone: "error", title: "Could not save", description: error.message });
      return;
    }
    push({ tone: "success", title: "Name updated" });
    router.refresh();
  }

  async function sendReset() {
    setBusy("reset");
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(profile.email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });
    setBusy(null);
    push(
      error
        ? { tone: "error", title: "Could not send", description: error.message }
        : { tone: "success", title: "Check your email", description: "A reset link is on its way." },
    );
  }

  return (
    <StaggerChildren className="space-y-4">
      <div className="card flex items-center gap-4 p-5">
        <Avatar name={profile.full_name} id={profile.id} size="lg" />
        <div className="min-w-0">
          <p className="truncate text-[0.9375rem] font-semibold tracking-tight text-ink">
            {profile.full_name}
          </p>
          <p className="truncate text-[0.8125rem] text-ink-muted">{profile.email}</p>
        </div>
        <Badge tone={ROLE_META[profile.role].tone} className="ml-auto flex-none">
          {ROLE_META[profile.role].label}
        </Badge>
      </div>

      <form onSubmit={saveName} className="card space-y-4 p-5">
        <Field label="Display name" htmlFor="name" hint="Shown on your tickets and comments.">
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Department" hint="Only IT can change this.">
            <Input value={departmentName ?? "Not set"} disabled readOnly />
          </Field>
          <Field label="Role" hint={ROLE_META[profile.role].blurb}>
            <Input value={ROLE_META[profile.role].label} disabled readOnly />
          </Field>
        </div>

        <div className="flex justify-end border-t border-line pt-4">
          <Button
            type="submit"
            variant="primary"
            loading={busy === "name"}
            disabled={name.trim() === profile.full_name || !name.trim()}
          >
            Save
          </Button>
        </div>
      </form>

      <div className="card space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[0.875rem] font-medium text-ink">Password</p>
            <p className="mt-0.5 text-[0.8125rem] text-ink-muted">
              We&apos;ll email you a link to set a new one.
            </p>
          </div>
          <Button variant="secondary" loading={busy === "reset"} onClick={sendReset}>
            Send reset link
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
          <div>
            <p className="text-[0.875rem] font-medium text-ink">Sign out</p>
            <p className="mt-0.5 text-[0.8125rem] text-ink-muted">
              Active since {absoluteTime(profile.activated_at)}.
            </p>
          </div>
          <form action="/auth/signout" method="post">
            <Button type="submit" variant="danger">
              Sign out
            </Button>
          </form>
        </div>
      </div>
    </StaggerChildren>
  );
}
