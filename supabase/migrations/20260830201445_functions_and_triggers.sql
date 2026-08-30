-- ===== role helpers ========================================================
-- SECURITY DEFINER so RLS policies on profiles can call them without
-- recursing into profiles' own policies. A non-active user resolves to NULL,
-- which makes every downstream policy fail closed.

create or replace function public.current_profile_role()
returns public.user_role
language sql stable security definer set search_path = public, pg_temp as $$
  select role from public.profiles where id = auth.uid() and status = 'active';
$$;

create or replace function public.is_active_user()
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.profiles where id = auth.uid() and status = 'active');
$$;

create or replace function public.is_agent()
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.current_profile_role() in ('agent', 'admin'), false);
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.current_profile_role() = 'admin', false);
$$;

-- ===== email allow-list ====================================================
-- An address passes if it is an explicit exception OR its domain is allowed.
create or replace function public.is_email_allowed(p_email text)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when p_email is null or position('@' in p_email) = 0 then false
    when exists (
      select 1 from public.email_allowlist
       where lower(email) = lower(btrim(p_email))
    ) then true
    else exists (
      select 1
        from public.app_settings s
        cross join lateral unnest(s.allowed_email_domains) as d(domain)
       where s.id
         and lower(btrim(d.domain)) = lower(split_part(btrim(p_email), '@', 2))
    )
  end;
$$;

-- ===== SLA =================================================================
create or replace function public.sla_duration(p_priority public.ticket_priority)
returns interval
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select make_interval(mins => duration_minutes) from public.sla_rules where priority = p_priority),
    interval '8 hours'
  );
$$;

-- ===== profiles ============================================================
create or replace function public.profiles_guard()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  new.email      := lower(btrim(new.email));
  new.updated_at := now();

  if tg_op = 'INSERT' then
    if not public.is_email_allowed(new.email) then
      raise exception 'Address % is not permitted: add its domain or the address itself to the allow-list first.', new.email
        using errcode = '22023';
    end if;
    return new;
  end if;

  -- Admins (and server-side/service-role callers, where auth.uid() is null)
  -- may change anything; keep the lifecycle timestamps honest for them.
  if public.is_admin() or auth.uid() is null then
    if new.email is distinct from old.email and not public.is_email_allowed(new.email) then
      raise exception 'Address % is not permitted by the allow-list.', new.email using errcode = '22023';
    end if;
    if new.status = 'disabled' and old.status <> 'disabled' then
      new.disabled_at := now();
    elsif new.status <> 'disabled' and old.status = 'disabled' then
      new.disabled_at := null;
    end if;
    if new.status = 'active' and old.status <> 'active' then
      new.activated_at := coalesce(old.activated_at, now());
    end if;
    return new;
  end if;

  -- Everyone else may edit their display name and nothing else.
  if new.id            is distinct from old.id
  or new.role          is distinct from old.role
  or new.status        is distinct from old.status
  or new.email         is distinct from old.email
  or new.department_id is distinct from old.department_id then
    raise exception 'Only an admin can change role, status, email or department.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger t10_profiles_guard
  before insert or update on public.profiles
  for each row execute function public.profiles_guard();

-- Provision the profile from the invite metadata the admin API attaches.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.profiles (
    id, email, full_name, department_id, role, status, invited_by, invited_at, last_invite_sent_at
  ) values (
    new.id,
    lower(new.email),
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)),
    nullif(new.raw_user_meta_data ->> 'department_id', '')::uuid,
    coalesce(nullif(new.raw_user_meta_data ->> 'role', '')::public.user_role, 'user'),
    case when new.email_confirmed_at is not null then 'active' else 'pending' end::public.user_status,
    nullif(new.raw_user_meta_data ->> 'invited_by', '')::uuid,
    coalesce(new.invited_at, now()),
    coalesce(new.invited_at, now())
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Accepting the invite (email confirmed) flips pending -> active.
-- A disabled account must never be revived by this path.
create or replace function public.handle_auth_user_confirmed()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.email_confirmed_at is not null and old.email_confirmed_at is null then
    update public.profiles
       set status       = case when status = 'disabled' then 'disabled' else 'active' end::public.user_status,
           activated_at = coalesce(activated_at, now()),
           updated_at   = now()
     where id = new.id;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_confirmed
  after update on auth.users
  for each row execute function public.handle_auth_user_confirmed();

-- ===== tickets =============================================================
create or replace function public.tickets_before_insert()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_rule public.routing_rules%rowtype;
begin
  -- Never trust a client-supplied author or department.
  if auth.uid() is not null then
    new.created_by := auth.uid();
  end if;
  select department_id into new.department_id from public.profiles where id = new.created_by;

  select * into v_rule
    from public.routing_rules
   where lower(category) = lower(btrim(new.category)) and is_active
   limit 1;

  if found then
    if v_rule.default_priority is not null and new.priority = 'normal' then
      new.priority := v_rule.default_priority;
    end if;
    if v_rule.default_department_id is not null and new.department_id is null then
      new.department_id := v_rule.default_department_id;
    end if;
  end if;

  new.status          := 'new';
  new.assigned_to     := null;
  new.work_started_at := null;
  new.first_response_at := null;
  new.resolved_at     := null;
  new.closed_at       := null;
  new.sla_paused_at   := null;
  new.reopen_count    := 0;
  new.created_at      := now();
  new.updated_at      := now();
  new.sla_due_at      := now() + public.sla_duration(new.priority);
  return new;
end;
$$;

create trigger t10_tickets_before_insert
  before insert on public.tickets
  for each row execute function public.tickets_before_insert();

-- Requesters may confirm or reopen their own resolved ticket. Nothing else.
create or replace function public.tickets_guard_update()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if public.is_agent()
     or auth.uid() is null
     or coalesce(current_setting('app.bypass_ticket_guard', true), 'off') = 'on' then
    return new;
  end if;

  if new.id              is distinct from old.id
  or new.ticket_number   is distinct from old.ticket_number
  or new.created_by      is distinct from old.created_by
  or new.department_id   is distinct from old.department_id
  or new.category        is distinct from old.category
  or new.subject         is distinct from old.subject
  or new.description     is distinct from old.description
  or new.priority        is distinct from old.priority
  or new.assigned_to     is distinct from old.assigned_to
  or new.created_at      is distinct from old.created_at
  or new.sla_due_at      is distinct from old.sla_due_at
  or new.sla_paused_at   is distinct from old.sla_paused_at
  or new.work_started_at is distinct from old.work_started_at
  or new.first_response_at is distinct from old.first_response_at
  or new.resolved_at     is distinct from old.resolved_at
  or new.closed_at       is distinct from old.closed_at
  or new.reopen_count    is distinct from old.reopen_count then
    raise exception 'Only an agent can change this ticket.' using errcode = '42501';
  end if;

  if new.status is distinct from old.status
     and not (old.status = 'resolved' and new.status in ('closed', 'reopened')) then
    raise exception 'You can only confirm or reopen a resolved ticket.' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger t20_tickets_guard_update
  before update on public.tickets
  for each row execute function public.tickets_guard_update();

-- Derive lifecycle timestamps and the SLA clock from the status transition.
create or replace function public.tickets_apply_state()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  new.updated_at := now();

  -- Assignment and status stay in step with each other.
  if new.assigned_to is not null and old.assigned_to is null and new.status = 'new' then
    new.status := 'assigned';
  elsif new.assigned_to is null and old.assigned_to is not null and new.status = 'assigned' then
    new.status := 'new';
  end if;

  if new.status is distinct from old.status then
    if new.status = 'in_progress' and new.work_started_at is null then
      new.work_started_at := now();
    end if;

    if new.status = 'resolved' then
      new.resolved_at := now();
      new.closed_at   := null;
    elsif new.status = 'closed' then
      new.closed_at   := now();
      new.resolved_at := coalesce(old.resolved_at, now());
    elsif new.status = 'reopened' then
      new.reopen_count := old.reopen_count + 1;
      new.resolved_at  := null;
      new.closed_at    := null;
      new.sla_paused_at := null;
      new.sla_due_at   := now() + public.sla_duration(new.priority);
    else
      new.resolved_at := null;
      new.closed_at   := null;
    end if;

    -- The SLA clock pauses while the ball is in the requester's court.
    if new.status = 'waiting_on_user' and old.status <> 'waiting_on_user' then
      new.sla_paused_at := now();
    elsif old.status = 'waiting_on_user' and new.status <> 'waiting_on_user' and old.sla_paused_at is not null then
      new.sla_due_at    := new.sla_due_at + (now() - old.sla_paused_at);
      new.sla_paused_at := null;
    end if;
  end if;

  -- Re-prioritising re-targets the SLA from the ticket's original start.
  if new.priority is distinct from old.priority and new.status not in ('resolved', 'closed') then
    new.sla_due_at := new.created_at + public.sla_duration(new.priority);
  end if;

  return new;
end;
$$;

create trigger t30_tickets_apply_state
  before update on public.tickets
  for each row execute function public.tickets_apply_state();

-- ===== audit trail =========================================================
create or replace function public.tickets_audit()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    insert into public.ticket_events (ticket_id, actor_id, event_type, to_value, metadata)
    values (new.id, coalesce(auth.uid(), new.created_by), 'created', new.status::text,
            jsonb_build_object('priority', new.priority, 'category', new.category));
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.ticket_events (ticket_id, actor_id, event_type, from_value, to_value)
    values (new.id, auth.uid(), 'status_changed', old.status::text, new.status::text);
  end if;

  if new.assigned_to is distinct from old.assigned_to then
    insert into public.ticket_events (ticket_id, actor_id, event_type, from_value, to_value)
    values (new.id, auth.uid(),
            case when new.assigned_to is null then 'unassigned' else 'assigned' end,
            old.assigned_to::text, new.assigned_to::text);
  end if;

  if new.priority is distinct from old.priority then
    insert into public.ticket_events (ticket_id, actor_id, event_type, from_value, to_value)
    values (new.id, auth.uid(), 'priority_changed', old.priority::text, new.priority::text);
  end if;

  return new;
end;
$$;

create trigger t90_tickets_audit
  after insert or update on public.tickets
  for each row execute function public.tickets_audit();

create or replace function public.comments_after_insert()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_author_role public.user_role;
begin
  insert into public.ticket_events (ticket_id, actor_id, event_type, metadata)
  values (new.ticket_id, new.author_id, 'commented',
          jsonb_build_object('is_internal', new.is_internal, 'comment_id', new.id));

  select role into v_author_role from public.profiles where id = new.author_id;

  if v_author_role in ('agent', 'admin') and not new.is_internal then
    perform set_config('app.bypass_ticket_guard', 'on', true);
    update public.tickets
       set first_response_at = now()
     where id = new.ticket_id and first_response_at is null;
    perform set_config('app.bypass_ticket_guard', 'off', true);
  end if;

  return new;
end;
$$;

create trigger t90_comments_after_insert
  after insert on public.ticket_comments
  for each row execute function public.comments_after_insert();

-- ===== auto-assignment =====================================================
-- Routing rule wins; otherwise fall back to the configured strategy.
create or replace function public.auto_assign_ticket(p_ticket_id uuid)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_strategy   text;
  v_category   text;
  v_rule_agent uuid;
  v_agent      uuid;
begin
  select coalesce(auto_assign_strategy, 'off') into v_strategy from public.app_settings where id;
  select category into v_category from public.tickets where id = p_ticket_id;

  select default_assignee_id into v_rule_agent
    from public.routing_rules
   where lower(category) = lower(btrim(v_category)) and is_active
   limit 1;

  if v_rule_agent is not null then
    select id into v_agent
      from public.profiles
     where id = v_rule_agent and status = 'active' and role in ('agent', 'admin');
  end if;

  if v_agent is null and v_strategy = 'least_busy' then
    select p.id into v_agent
      from public.profiles p
      left join public.tickets t
        on t.assigned_to = p.id
       and t.status in ('new', 'assigned', 'in_progress', 'waiting_on_user', 'reopened')
     where p.status = 'active' and p.role in ('agent', 'admin')
     group by p.id
     order by count(t.id) asc, random()
     limit 1;
  elsif v_agent is null and v_strategy = 'round_robin' then
    select p.id into v_agent
      from public.profiles p
      left join lateral (
        select max(t.created_at) as last_assigned_at
          from public.tickets t where t.assigned_to = p.id
      ) l on true
     where p.status = 'active' and p.role in ('agent', 'admin')
     order by l.last_assigned_at asc nulls first, p.created_at asc
     limit 1;
  end if;

  if v_agent is not null then
    perform set_config('app.bypass_ticket_guard', 'on', true);
    update public.tickets
       set assigned_to = v_agent,
           status = case when status = 'new' then 'assigned'::public.ticket_status else status end
     where id = p_ticket_id;
    perform set_config('app.bypass_ticket_guard', 'off', true);
  end if;

  return v_agent;
end;
$$;

create or replace function public.tickets_after_insert_assign()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.auto_assign_ticket(new.id);
  return new;
end;
$$;

create trigger t50_tickets_auto_assign
  after insert on public.tickets
  for each row execute function public.tickets_after_insert_assign();

-- ===== generic touch =======================================================
create or replace function public.touch_updated_at()
returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger t10_sla_rules_touch    before update on public.sla_rules
  for each row execute function public.touch_updated_at();
create trigger t10_app_settings_touch before update on public.app_settings
  for each row execute function public.touch_updated_at();
