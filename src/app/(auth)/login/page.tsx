import type { Metadata } from "next";
import { LoginForm } from "./login-form";
import { AuthShell } from "@/components/shell/auth-shell";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  disabled:
    "This account has been disabled. Your ticket history is retained — contact IT to be re-enabled.",
  inactive: "This account is not active yet. Use the invite link sent to your email.",
  link_expired: "That link has expired. Ask an administrator to resend your invite.",
  link_invalid: "That link is not valid. Ask an administrator to resend your invite.",
  password_set: "Password set. Sign in with your new password.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const params = await searchParams;
  const notice = params.error ? ERRORS[params.error] : undefined;

  return (
    <AuthShell
      title="Sign in"
      subtitle="Use your Aavis Pharma email address and password."
      footer={
        <>
          Accounts are created by IT.{" "}
          <span className="text-ink-faint">There is no public sign-up.</span>
        </>
      }
    >
      <LoginForm
        notice={notice}
        noticeTone={params.error === "password_set" ? "success" : "error"}
        next={params.next}
      />
    </AuthShell>
  );
}
