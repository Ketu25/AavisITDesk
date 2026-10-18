import type { Metadata } from "next";
import { AuthShell } from "@/components/shell/auth-shell";
import { ActivateClient } from "./activate-client";

export const metadata: Metadata = { title: "Set up your account" };

export default function ActivatePage() {
  return (
    <AuthShell
      title="Set up your account"
      subtitle="Sign in with the temporary password IT gave you, then choose your own."
      footer={
        <>
          Already set your password?{" "}
          <a href="/login" className="text-accent underline-offset-4 hover:underline">
            Sign in
          </a>
        </>
      }
    >
      <ActivateClient />
    </AuthShell>
  );
}
