-- Trigger functions and privileged helpers must not be reachable over
-- /rest/v1/rpc. PostgreSQL checks EXECUTE when a trigger is CREATED, not when
-- it fires, so revoking here does not affect any trigger already attached.
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.auto_assign_ticket(uuid)',
    'public.comments_after_insert()',
    'public.handle_auth_user_confirmed()',
    'public.handle_new_auth_user()',
    'public.is_email_allowed(text)',
    'public.profiles_guard()',
    'public.sla_duration(public.ticket_priority)',
    'public.tickets_after_insert_assign()',
    'public.tickets_apply_state()',
    'public.tickets_audit()',
    'public.tickets_before_insert()',
    'public.tickets_guard_update()',
    'public.tickets_notify_new()',
    'public.touch_updated_at()'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
  end loop;
end;
$$;

-- These four stay executable: RLS policies reference them, and policy
-- evaluation runs as the calling role. They only ever reveal the caller's
-- own role, which the caller already knows.
grant execute on function public.is_admin()             to authenticated;
grant execute on function public.is_agent()             to authenticated;
grant execute on function public.is_active_user()       to authenticated;
grant execute on function public.current_profile_role() to authenticated;
revoke all on function public.is_admin()             from anon;
revoke all on function public.is_agent()             from anon;
revoke all on function public.is_active_user()       from anon;
revoke all on function public.current_profile_role() from anon;

-- Reporting is self-gating on is_agent(); signed-in only.
revoke all on function public.report_summary(timestamptz, timestamptz) from public, anon;
grant execute on function public.report_summary(timestamptz, timestamptz) to authenticated;
