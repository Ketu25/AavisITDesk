import type { Metadata } from "next";
import { AuthShell } from "@/components/shell/auth-shell";
import { InviteClient } from "./invite-client";

export const metadata: Metadata = { title: "Accept your invite" };

export default function InvitePage() {
  return (
    <AuthShell
      title="Choose your password"
      subtitle="Set a password to activate your Aavis IT Desk account. You only do this once."
    >
      <InviteClient />
    </AuthShell>
  );
}
