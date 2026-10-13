-- ============================================================================
-- Quick tickets: the common problems a requester can report without writing a
-- ticket from scratch — "Printer → Paper jam", "Shared drive → Not showing".
--
-- An admin writes each one once: the routing category, the title and details
-- IT receives, the urgency, and optionally one question to ask the requester
-- ("Which printer?"). The requester picks it, checks it, and sends it.
--
-- A quick ticket is a template, not a link: the ticket it raises is a copy of
-- the text at that moment, so editing a template never rewrites a ticket that
-- was already sent. `tickets.quick_ticket_id` records where a ticket came from
-- — for spotting a requester reporting the same thing twice, and for showing
-- admins which quick tickets are actually used.
-- ============================================================================

-- --------------------------------------------------------------- groups ----
create table public.quick_ticket_groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 1 and 60),
  description text check (description is null or length(btrim(description)) between 1 and 160),
  -- Drawn by the app from its own icon set; anything else would render blank.
  icon        text not null default 'bolt'
                check (icon in ('printer', 'folder', 'wifi', 'mail', 'monitor', 'phone',
                                'key', 'shield', 'app', 'wrench', 'bolt')),
  is_active   boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index quick_ticket_groups_name_unique
  on public.quick_ticket_groups (lower(btrim(name)));

create trigger t10_quick_ticket_groups_touch
  before update on public.quick_ticket_groups
  for each row execute function public.touch_updated_at();

-- -------------------------------------------------------- quick tickets ----
-- By routing rule id rather than category text, so renaming a category cannot
-- strand a quick ticket on a name nothing routes any more. A rule that quick
-- tickets point at cannot be deleted out from under them.
create table public.quick_tickets (
  id              uuid primary key default gen_random_uuid(),
  group_id        uuid not null references public.quick_ticket_groups (id) on delete cascade,
  routing_rule_id uuid not null references public.routing_rules (id) on delete restrict,
  label           text not null check (length(btrim(label)) between 2 and 60),
  subject         text not null check (length(btrim(subject)) between 3 and 160),
  -- Well under a ticket's 8000, so the requester's answer and note always fit.
  description     text not null check (length(btrim(description)) between 5 and 2000),
  priority        public.ticket_priority not null default 'normal',
  detail_prompt   text check (detail_prompt is null or length(btrim(detail_prompt)) between 3 and 120),
  detail_required boolean not null default false,
  is_active       boolean not null default true,
  sort_order      integer not null default 0,
  -- Bumped only when what a requester is shown changes (see the trigger
  -- below). The confirm dialog sends back the revision it displayed, so a
  -- template edited while someone is looking at it is never sent unseen; the
  -- admin editor uses it the same way, so two admins cannot silently
  -- overwrite each other.
  revision        integer not null default 1,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint quick_tickets_required_needs_prompt
    check (detail_prompt is not null or not detail_required)
);
create unique index quick_tickets_label_unique
  on public.quick_tickets (group_id, lower(btrim(label)));
create index quick_tickets_group_idx on public.quick_tickets (group_id, sort_order);
create index quick_tickets_rule_idx  on public.quick_tickets (routing_rule_id);

create or replace function public.quick_tickets_before_update()
returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  new.updated_at := now();
  -- Reordering and switching live/hidden change nothing a requester reads, so
  -- they must not invalidate a dialog that is open on this quick ticket.
  if (new.label, new.subject, new.description, new.priority, new.detail_prompt,
      new.detail_required, new.routing_rule_id, new.group_id)
     is distinct from
     (old.label, old.subject, old.description, old.priority, old.detail_prompt,
      old.detail_required, old.routing_rule_id, old.group_id)
  then
    new.revision := old.revision + 1;
  else
    new.revision := old.revision;
  end if;
  return new;
end;
$$;

create trigger t10_quick_tickets_before_update
  before update on public.quick_tickets
  for each row execute function public.quick_tickets_before_update();

-- ------------------------------------------------------------- tickets ----
-- `restrict`: a quick ticket that has raised tickets is hidden, not deleted,
-- the same rule routing categories follow. Deleting it would otherwise rewrite
-- every one of those tickets (and bump their updated_at) to null the link.
alter table public.tickets
  add column quick_ticket_id uuid references public.quick_tickets (id) on delete restrict;

-- Serves the "already reported" check (this quick ticket, this requester),
-- the usage counts, and the restrict check when a quick ticket is deleted.
create index tickets_quick_ticket_idx
  on public.tickets (quick_ticket_id, created_by)
  where quick_ticket_id is not null;

-- Unchanged from functions_and_triggers except for the quick-ticket block.
create or replace function public.tickets_before_insert()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_rule public.routing_rules%rowtype;
  v_quick_category text;
begin
  -- Never trust a client-supplied author or department.
  if auth.uid() is not null then
    new.created_by := auth.uid();
  end if;
  select department_id into new.department_id from public.profiles where id = new.created_by;

  -- A quick ticket stands for exactly one routing category, whatever the
  -- client sent, and only while an admin is still offering it — checked here,
  -- in the insert itself, so one switched off a moment ago cannot slip through
  -- between the API's check and this row landing.
  if new.quick_ticket_id is not null then
    select r.category into v_quick_category
      from public.quick_tickets q
      join public.quick_ticket_groups g on g.id = q.group_id
      join public.routing_rules r on r.id = q.routing_rule_id
     where q.id = new.quick_ticket_id
       and q.is_active and g.is_active and r.is_active;

    if not found then
      raise exception 'That quick ticket is no longer offered.' using errcode = '22023';
    end if;
    new.category := v_quick_category;
  end if;

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

-- Unchanged except that requesters may not rewrite where a ticket came from.
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
  or new.reopen_count    is distinct from old.reopen_count
  or new.quick_ticket_id is distinct from old.quick_ticket_id then
    raise exception 'Only an agent can change this ticket.' using errcode = '42501';
  end if;

  if new.status is distinct from old.status
     and not (old.status = 'resolved' and new.status in ('closed', 'reopened')) then
    raise exception 'You can only confirm or reopen a resolved ticket.' using errcode = '42501';
  end if;

  return new;
end;
$$;

-- ------------------------------------------------------------------ RLS ----
alter table public.quick_ticket_groups enable row level security;
alter table public.quick_tickets       enable row level security;

-- Requesters read what is live; admins read everything, hidden included, to
-- manage it. Writes are admin-only and go through the API routes.
create policy quick_ticket_groups_select on public.quick_ticket_groups
  for select to authenticated
  using ((select public.is_admin()) or (is_active and (select public.is_active_user())));
create policy quick_ticket_groups_admin_insert on public.quick_ticket_groups
  for insert to authenticated with check ((select public.is_admin()));
create policy quick_ticket_groups_admin_update on public.quick_ticket_groups
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy quick_ticket_groups_admin_delete on public.quick_ticket_groups
  for delete to authenticated using ((select public.is_admin()));

create policy quick_tickets_select on public.quick_tickets
  for select to authenticated
  using (
    (select public.is_admin())
    or (
      is_active
      and (select public.is_active_user())
      and exists (
        select 1 from public.quick_ticket_groups g
         where g.id = quick_tickets.group_id and g.is_active
      )
    )
  );
create policy quick_tickets_admin_insert on public.quick_tickets
  for insert to authenticated with check ((select public.is_admin()));
create policy quick_tickets_admin_update on public.quick_tickets
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy quick_tickets_admin_delete on public.quick_tickets
  for delete to authenticated using ((select public.is_admin()));

-- ------------------------------------------------------------ ordering ----
-- Whole-list writes, for the same reasons as reorder_routing_rules: one
-- transaction, queued behind any other reorder, and refused when the list is
-- not exactly what is in the table now.
create or replace function public.reorder_quick_ticket_groups(p_ids uuid[])
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_total integer;
begin
  if not public.is_admin() then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;

  lock table public.quick_ticket_groups in share row exclusive mode;

  select count(*) into v_total from public.quick_ticket_groups;

  if p_ids is null
     or coalesce(cardinality(p_ids), 0) <> v_total
     or (select count(distinct g.id) from public.quick_ticket_groups g where g.id = any (p_ids)) <> v_total
  then
    raise exception 'The groups changed while you were reordering them. They have been reloaded — please try again.'
      using errcode = '22023';
  end if;

  update public.quick_ticket_groups g
     set sort_order = (o.position * 10)::integer
    from unnest(p_ids) with ordinality as o (id, position)
   where g.id = o.id
     and g.sort_order is distinct from (o.position * 10)::integer;
end;
$$;

create or replace function public.reorder_quick_tickets(p_group_id uuid, p_ids uuid[])
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_total integer;
begin
  if not public.is_admin() then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;

  lock table public.quick_tickets in share row exclusive mode;

  if not exists (select 1 from public.quick_ticket_groups where id = p_group_id) then
    raise exception 'That group no longer exists. The page has been reloaded.' using errcode = 'P0002';
  end if;

  select count(*) into v_total from public.quick_tickets where group_id = p_group_id;

  if p_ids is null
     or coalesce(cardinality(p_ids), 0) <> v_total
     or (select count(distinct q.id) from public.quick_tickets q
          where q.group_id = p_group_id and q.id = any (p_ids)) <> v_total
  then
    raise exception 'This group changed while you were reordering it. It has been reloaded — please try again.'
      using errcode = '22023';
  end if;

  update public.quick_tickets q
     set sort_order = (o.position * 10)::integer
    from unnest(p_ids) with ordinality as o (id, position)
   where q.id = o.id
     and q.group_id = p_group_id
     and q.sort_order is distinct from (o.position * 10)::integer;
end;
$$;

-- --------------------------------------------------------------- usage ----
-- Counted in the database: a list of ticket rows fetched to count in the app
-- would stop at PostgREST's max-rows without saying so.
create or replace function public.quick_ticket_usage()
returns table (quick_ticket_id uuid, total bigint, last_30_days bigint, last_used_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;

  return query
    select t.quick_ticket_id,
           count(*),
           count(*) filter (where t.created_at >= now() - interval '30 days'),
           max(t.created_at)
      from public.tickets t
     where t.quick_ticket_id is not null
     group by t.quick_ticket_id;
end;
$$;

-- ---------------------------------------------------------- privileges ----
-- New functions are executable by PUBLIC (and, on Supabase, anon) by default.
revoke all on function public.quick_tickets_before_update() from public, anon, authenticated;

revoke all on function public.reorder_quick_ticket_groups(uuid[])     from public, anon;
revoke all on function public.reorder_quick_tickets(uuid, uuid[])     from public, anon;
revoke all on function public.quick_ticket_usage()                    from public, anon;
grant execute on function public.reorder_quick_ticket_groups(uuid[])  to authenticated;
grant execute on function public.reorder_quick_tickets(uuid, uuid[])  to authenticated;
grant execute on function public.quick_ticket_usage()                 to authenticated;

-- ---------------------------------------------------------------- seed ----
-- A starting set to edit, not a fixed list. Each quick ticket is only created
-- when its routing category exists, so a desk that has renamed or removed one
-- simply gets fewer.
insert into public.quick_ticket_groups (name, description, icon, sort_order) values
  ('Printer',      'Jams, toner, scanning and printing', 'printer', 10),
  ('Shared drive', 'Network drives and folder access',   'folder',  20)
on conflict do nothing;

insert into public.quick_tickets (
  group_id, routing_rule_id, label, subject, description, priority,
  detail_prompt, detail_required, sort_order
)
select g.id, r.id, v.label, v.subject, v.description, 'normal'::public.ticket_priority,
       v.prompt, v.required, v.sort_order
  from (values
    ('Printer', 'Printing & Scanning', 'Paper jam',
     'Printer: paper jam',
     'Paper is stuck in the printer and it won''t print until the jam is cleared.',
     'Which printer? The name on its label, or where it is.', true, 10),
    ('Printer', 'Printing & Scanning', 'Toner needs replacing',
     'Printer: toner needs replacing',
     'The printer says the toner is low or empty, or prints are coming out faded or streaky.',
     'Which printer? The name on its label, or where it is.', true, 20),
    ('Printer', 'Printing & Scanning', 'Scanning not working',
     'Scanner: scanning not working',
     'Scanning fails, or the scans never arrive in my email or the scan folder.',
     'Which printer or scanner, and where should the scans go?', true, 30),
    ('Printer', 'Printing & Scanning', 'Nothing prints',
     'Printer: jobs not printing',
     'Print jobs are sent but nothing comes out, or the printer shows as offline on my computer.',
     'Which printer? The name on its label, or where it is.', true, 40),
    ('Shared drive', 'Account & Access', 'Drive not showing',
     'Shared drive: drive not showing',
     'A shared network drive I normally use is missing from File Explorer on my computer.',
     'Which drive? The letter or path, e.g. S: or \\server\share', false, 10),
    ('Shared drive', 'Network & Connectivity', 'Can''t connect to the drive',
     'Shared drive: can''t connect',
     'The shared drive is listed but won''t open: it shows as disconnected, asks for a password again, or times out.',
     'Which drive? The letter or path, e.g. S: or \\server\share', false, 20),
    ('Shared drive', 'Account & Access', 'Access denied to a folder',
     'Shared drive: access denied to a folder',
     'I get "access denied" when I open a folder on the shared drive that I need for my work.',
     'Which folder, and do you need to view it or edit it?', true, 30)
  ) as v (group_name, category, label, subject, description, prompt, required, sort_order)
  join public.quick_ticket_groups g on lower(g.name) = lower(v.group_name)
  join public.routing_rules r on lower(r.category) = lower(v.category)
on conflict do nothing;
