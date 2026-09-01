import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/database.types";

export type AuthContext = {
  userId: string;
  email: string;
  profile: Profile;
  isAgent: boolean;
  isAdmin: boolean;
};

/** Resolves the signed-in user and their profile, or null when signed out. */
export async function getAuthContext(): Promise<AuthContext | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) return null;

  return {
    userId: user.id,
    email: user.email ?? profile.email,
    profile,
    isAgent: profile.role === "agent" || profile.role === "admin",
    isAdmin: profile.role === "admin",
  };
}

/**
 * A disabled account keeps its history but must not hold a live session, so we
 * tear the session down rather than just bouncing the request.
 */
async function rejectInactive(status: string): Promise<never> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect(`/login?error=${status === "disabled" ? "disabled" : "inactive"}`);
}

export async function requireUser(): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");

  // Still on an admin-issued temporary password. The session is valid, but the
  // only thing it may do is replace that password — so send it there rather
  // than signing it out, which would strand the person in a loop.
  if (ctx.profile.must_change_password) redirect("/activate");

  if (ctx.profile.status !== "active") await rejectInactive(ctx.profile.status);
  return ctx;
}

export async function requireAgent(): Promise<AuthContext> {
  const ctx = await requireUser();
  if (!ctx.isAgent) redirect("/dashboard?denied=agent");
  return ctx;
}

export async function requireAdmin(): Promise<AuthContext> {
  const ctx = await requireUser();
  if (!ctx.isAdmin) redirect("/dashboard?denied=admin");
  return ctx;
}
