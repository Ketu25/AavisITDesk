import type { Metadata } from "next";
import { AuthShell } from "@/components/shell/auth-shell";
import { SetPasswordForm } from "@/components/shell/set-password-form";

export const metadata: Metadata = { title: "Choose a new password" };

export default function ResetPasswordPage() {
  return (
    <AuthShell
      title="Choose a new password"
      subtitle="Pick something you don't use anywhere else."
    >
      <SetPasswordForm submitLabel="Update password" />
    </AuthShell>
  );
}
