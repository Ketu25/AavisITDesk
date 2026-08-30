-- The webhook secret must never be reachable through PostgREST, so it lives
-- in a schema that is not exposed by the API.
create schema if not exists private;
revoke all on schema private from anon, authenticated;

create table if not exists private.notification_config (
  id                 boolean primary key default true check (id),
  functions_base_url text,
  webhook_secret     text not null default encode(gen_random_bytes(32), 'hex')
);
insert into private.notification_config (id) values (true) on conflict (id) do nothing;

-- ===== new-ticket fan-out ==================================================
-- Fires on insert so a ticket created by ANY path (app, SQL, import) notifies.
create or replace function public.tickets_notify_new()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_cfg private.notification_config%rowtype;
begin
  select * into v_cfg from private.notification_config where id;

  if v_cfg.functions_base_url is null or btrim(v_cfg.functions_base_url) = '' then
    insert into public.notification_log (ticket_id, channel, kind, status, detail)
    values (new.id, 'teams', 'new_ticket', 'skipped',
            'notify-new-ticket endpoint not configured yet');
    return new;
  end if;

  perform net.http_post(
    url     := rtrim(v_cfg.functions_base_url, '/') || '/notify-new-ticket',
    body    := jsonb_build_object('ticket_id', new.id, 'kind', 'new_ticket'),
    params  := '{}'::jsonb,
    headers := jsonb_build_object(
                 'Content-Type',    'application/json',
                 'x-webhook-secret', v_cfg.webhook_secret
               ),
    timeout_milliseconds := 5000
  );

  insert into public.notification_log (ticket_id, channel, kind, status, detail)
  values (new.id, 'teams', 'new_ticket', 'pending', 'dispatched to notify-new-ticket');

  return new;
end;
$$;

create trigger t95_tickets_notify_new
  after insert on public.tickets
  for each row execute function public.tickets_notify_new();

-- ===== escalation sweep ====================================================
-- Idempotent: safe to run every minute from pg_cron or an external scheduler.
-- v1 records the escalation and re-pings the channel; the notify function
-- reads `kind` so a future "notify the team lead directly" step is additive.
create or replace function public.run_sla_escalation()
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_cfg      private.notification_config%rowtype;
  v_settings public.app_settings%rowtype;
  v_ticket   record;
  v_unassigned int := 0;
  v_breached   int := 0;
begin
  select * into v_cfg from private.notification_config where id;
  select * into v_settings from public.app_settings where id;

  -- 1. Still nobody working it, past the configured threshold.
  for v_ticket in
    select t.id
      from public.tickets t
     where t.assigned_to is null
       and t.status in ('new', 'reopened')
       and t.created_at < now() - make_interval(mins => coalesce(v_settings.escalation_unassigned_minutes, 60))
       and not exists (
         select 1 from public.ticket_events e
          where e.ticket_id = t.id and e.event_type = 'escalated'
       )
  loop
    insert into public.ticket_events (ticket_id, event_type, to_value, metadata)
    values (v_ticket.id, 'escalated', 'unassigned',
            jsonb_build_object('threshold_minutes', v_settings.escalation_unassigned_minutes));

    if v_cfg.functions_base_url is not null then
      perform net.http_post(
        url     := rtrim(v_cfg.functions_base_url, '/') || '/notify-new-ticket',
        body    := jsonb_build_object('ticket_id', v_ticket.id, 'kind', 'escalation'),
        params  := '{}'::jsonb,
        headers := jsonb_build_object('Content-Type', 'application/json',
                                      'x-webhook-secret', v_cfg.webhook_secret),
        timeout_milliseconds := 5000
      );
    end if;
    v_unassigned := v_unassigned + 1;
  end loop;

  -- 2. SLA target has passed while the ticket is still open.
  for v_ticket in
    select t.id
      from public.tickets t
     where t.status not in ('resolved', 'closed')
       and t.sla_paused_at is null
       and t.sla_due_at < now()
       and not exists (
         select 1 from public.ticket_events e
          where e.ticket_id = t.id and e.event_type = 'sla_breached'
       )
  loop
    insert into public.ticket_events (ticket_id, event_type, to_value)
    values (v_ticket.id, 'sla_breached', 'breached');

    if v_cfg.functions_base_url is not null then
      perform net.http_post(
        url     := rtrim(v_cfg.functions_base_url, '/') || '/notify-new-ticket',
        body    := jsonb_build_object('ticket_id', v_ticket.id, 'kind', 'sla_breach'),
        params  := '{}'::jsonb,
        headers := jsonb_build_object('Content-Type', 'application/json',
                                      'x-webhook-secret', v_cfg.webhook_secret),
        timeout_milliseconds := 5000
      );
    end if;
    v_breached := v_breached + 1;
  end loop;

  return jsonb_build_object('escalated_unassigned', v_unassigned, 'sla_breached', v_breached);
end;
$$;

revoke all on function public.run_sla_escalation() from public, anon, authenticated;

-- ===== reporting ===========================================================
-- SECURITY DEFINER for aggregate speed, gated on is_agent() so a plain user
-- cannot read organisation-wide numbers.
create or replace function public.report_summary(
  p_from timestamptz default null,
  p_to   timestamptz default null
)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_from timestamptz := coalesce(p_from, now() - interval '30 days');
  v_to   timestamptz := coalesce(p_to, now());
begin
  if not public.is_agent() then
    raise exception 'Reporting is available to agents and admins only.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'range', jsonb_build_object('from', v_from, 'to', v_to),

    'totals', (
      select jsonb_build_object(
        'total',    count(*),
        'open',     count(*) filter (where status not in ('resolved', 'closed')),
        'resolved', count(*) filter (where status = 'resolved'),
        'closed',   count(*) filter (where status = 'closed'),
        'unassigned', count(*) filter (where assigned_to is null and status not in ('resolved', 'closed')),
        'breached', count(*) filter (where status not in ('resolved', 'closed') and sla_due_at < now()),
        'reopened', count(*) filter (where reopen_count > 0),
        'avg_resolution_minutes', round(avg(
          extract(epoch from (resolved_at - created_at)) / 60
        ) filter (where resolved_at is not null))::int,
        'avg_first_response_minutes', round(avg(
          extract(epoch from (first_response_at - created_at)) / 60
        ) filter (where first_response_at is not null))::int
      )
      from public.tickets where created_at between v_from and v_to
    ),

    'by_department', (
      select coalesce(jsonb_agg(x order by x->>'label'), '[]'::jsonb) from (
        select jsonb_build_object(
          'label', coalesce(d.name, 'Unassigned'),
          'count', count(t.id),
          'avg_resolution_minutes', round(avg(
            extract(epoch from (t.resolved_at - t.created_at)) / 60
          ) filter (where t.resolved_at is not null))::int
        ) as x
        from public.tickets t
        left join public.departments d on d.id = t.department_id
        where t.created_at between v_from and v_to
        group by d.name
      ) s
    ),

    'by_category', (
      select coalesce(jsonb_agg(x order by (x->>'count')::int desc), '[]'::jsonb) from (
        select jsonb_build_object('label', category, 'count', count(*)) as x
        from public.tickets where created_at between v_from and v_to group by category
      ) s
    ),

    'by_priority', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select jsonb_build_object('label', priority::text, 'count', count(*)) as x
        from public.tickets where created_at between v_from and v_to
        group by priority
        order by array_position(array['urgent','high','normal','low'], priority::text)
      ) s
    ),

    'by_status', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select jsonb_build_object('label', status::text, 'count', count(*)) as x
        from public.tickets where created_at between v_from and v_to group by status
      ) s
    ),

    'daily', (
      select coalesce(jsonb_agg(x order by x->>'date'), '[]'::jsonb) from (
        select jsonb_build_object(
          'date',     to_char(d.day, 'YYYY-MM-DD'),
          'created',  (select count(*) from public.tickets t
                        where t.created_at >= d.day and t.created_at < d.day + interval '1 day'),
          'resolved', (select count(*) from public.tickets t
                        where t.resolved_at >= d.day and t.resolved_at < d.day + interval '1 day')
        ) as x
        from generate_series(date_trunc('day', v_from), date_trunc('day', v_to), interval '1 day') as d(day)
      ) s
    ),

    'agents', (
      select coalesce(jsonb_agg(x order by (x->>'resolved')::int desc), '[]'::jsonb) from (
        select jsonb_build_object(
          'label',      p.full_name,
          'open',       count(t.id) filter (where t.status not in ('resolved', 'closed')),
          'resolved',   count(t.id) filter (where t.resolved_at between v_from and v_to),
          'avg_resolution_minutes', round(avg(
            extract(epoch from (t.resolved_at - t.created_at)) / 60
          ) filter (where t.resolved_at between v_from and v_to))::int
        ) as x
        from public.profiles p
        left join public.tickets t on t.assigned_to = p.id
        where p.role in ('agent', 'admin') and p.status = 'active'
        group by p.id, p.full_name
      ) s
    )
  );
end;
$$;
