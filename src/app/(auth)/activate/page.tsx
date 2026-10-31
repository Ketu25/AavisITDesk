import type { Metadata } from "next";
import { AuthShell } from "@/components/shell/auth-shell";
import { safeNextPath } from "@/lib/safe-next";
import { ActivateClient } from "./activate-client";

export const metadata: Metadata = { title: "Set up your account" };

export default async function ActivatePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  // Where someone was headed when the desk stopped them to replace a
  // temporary password — a scanned QR label, say. Carried on to sign-in too.
  const next = safeNextPath((await searchParams).next);

  return (
    <AuthShell
      title="Set up your account"
      subtitle="Sign in with the temporary password IT gave you, then choose your own."
      footer={
        <>
          Already set your password?{" "}
          <a
            href={next ? `/login?${new URLSearchParams({ next })}` : "/login"}
            className="text-accent underline-offset-4 hover:underline"
          >
            Sign in
          </a>
        </>
      }
    >
      <ActivateClient next={next} />
    </AuthShell>
  );
}
