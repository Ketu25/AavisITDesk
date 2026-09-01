"use client";

import { Suspense } from "react";
import { TokenGate } from "@/components/shell/token-gate";
import { SetPasswordForm } from "@/components/shell/set-password-form";
import { Spinner } from "@/components/ui/spinner";

export function InviteClient() {
  return (
    <Suspense fallback={<Spinner />}>
      <TokenGate
        type="invite"
        actionLabel="Set up my account"
        intro="Press the button below to accept your invitation, then choose a password."
      >
        <SetPasswordForm submitLabel="Activate my account" />
      </TokenGate>
    </Suspense>
  );
}
