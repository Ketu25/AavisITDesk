-- Postgres grants EXECUTE to PUBLIC by default, and `anon` inherits from
-- PUBLIC — so revoking from `anon` alone left these reachable to signed-out
-- callers. Revoke from PUBLIC, then grant back only to `authenticated`.
revoke all on function public.is_admin()             from public, anon, authenticated;
revoke all on function public.is_agent()             from public, anon, authenticated;
revoke all on function public.is_active_user()       from public, anon, authenticated;
revoke all on function public.current_profile_role() from public, anon, authenticated;

-- RLS policies reference these and policy evaluation runs as the calling role,
-- so `authenticated` must keep EXECUTE. They only ever reveal the caller's own
-- role, which the caller already knows.
grant execute on function public.is_admin()             to authenticated;
grant execute on function public.is_agent()             to authenticated;
grant execute on function public.is_active_user()       to authenticated;
grant execute on function public.current_profile_role() to authenticated;

-- Same PUBLIC default applies to the admin-gated helpers.
revoke all on function public.get_notification_endpoint()     from public, anon;
revoke all on function public.set_notification_endpoint(text) from public, anon;
revoke all on function public.rotate_notification_secret()    from public, anon;
revoke all on function public.report_summary(timestamptz, timestamptz) from public, anon;
