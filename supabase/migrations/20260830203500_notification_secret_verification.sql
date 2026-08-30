-- Lets the edge function validate the shared secret without the operator
-- having to copy it into a function env var. Constant-time-ish comparison and
-- service-role only, so a signed-in user cannot brute-force it.
create or replace function public.verify_notification_secret(p_secret text)
returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_expected text;
begin
  select webhook_secret into v_expected from private.notification_config where id;
  if v_expected is null or p_secret is null then
    return false;
  end if;
  return encode(digest(v_expected, 'sha256'), 'hex') = encode(digest(p_secret, 'sha256'), 'hex');
end;
$$;

revoke all on function public.verify_notification_secret(text) from public, anon, authenticated;
grant execute on function public.verify_notification_secret(text) to service_role;

-- The edge function reads ticket context through this one call rather than
-- five round trips, and it is service-role only for the same reason.
create or replace function public.notification_payload(p_ticket_id uuid)
returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'ticket', jsonb_build_object(
      'id',            t.id,
      'ticket_number', t.ticket_number,
      'subject',       t.subject,
      'description',   left(t.description, 600),
      'category',      t.category,
      'priority',      t.priority,
      'status',        t.status,
      'created_at',    t.created_at,
      'sla_due_at',    t.sla_due_at,
      'department',    d.name,
      'requester',     c.full_name,
      'requester_email', c.email,
      'assignee',      a.full_name
    ),
    'settings', jsonb_build_object(
      'teams_webhook_url',     s.teams_webhook_url,
      'it_distribution_email', s.it_distribution_email,
      'notify_teams_enabled',  s.notify_teams_enabled,
      'notify_email_enabled',  s.notify_email_enabled,
      'app_base_url',          s.app_base_url
    )
  )
  from public.tickets t
  left join public.departments d on d.id = t.department_id
  left join public.profiles   c on c.id = t.created_by
  left join public.profiles   a on a.id = t.assigned_to
  cross join public.app_settings s
  where t.id = p_ticket_id and s.id;
$$;

revoke all on function public.notification_payload(uuid) from public, anon, authenticated;
grant execute on function public.notification_payload(uuid) to service_role;
