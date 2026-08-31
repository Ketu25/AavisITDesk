import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthShell } from "@/components/shell/auth-shell";
import { SetPasswordForm } from "@/components/shell/set-password-form";
import { TokenGate } from "@/components/shell/token-gate";
import { Spinner } from "@/components/ui/spinner";

export const metadata: Metadata = { title: "Choose a new password" };

export default function ResetPasswordPage() {
  return (
    <AuthShell
      title="Choose a new password"
      subtitle="Pick something you don't use anywhere else."
    >
      <Suspense fallback={<Spinner />}>
        <TokenGate
          type="recovery"
          actionLabel="Continue"
          intro="Press the button below to confirm it's really you, then choose a new password."
        >
          <SetPasswordForm submitLabel="Update password" />
        </TokenGate>
      </Suspense>
    </AuthShell>
  );
}
