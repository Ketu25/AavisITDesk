alter table public.departments      enable row level security;
alter table public.profiles         enable row level security;
alter table public.app_settings     enable row level security;
alter table public.email_allowlist  enable row level security;
alter table public.sla_rules        enable row level security;
alter table public.routing_rules    enable row level security;
alter table public.tickets          enable row level security;
alter table public.ticket_comments  enable row level security;
alter table public.ticket_events    enable row level security;
alter table public.notification_log enable row level security;

-- ---------------------------------------------------------- departments ----
create policy departments_select on public.departments
  for select to authenticated using (public.is_active_user());
create policy departments_admin_write on public.departments
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ------------------------------------------------------------- profiles ----
-- ~100 colleagues in one company: the staff directory is readable by any
-- active account so assignee/requester names resolve without a service key.
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_active_user());

-- The profiles_guard trigger decides which columns each caller may touch.
create policy profiles_self_update on public.profiles
  for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy profiles_admin_update on public.profiles
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy profiles_admin_insert on public.profiles
  for insert to authenticated with check (public.is_admin());

-- No delete policy anywhere: accounts are disabled, never destroyed.

-- --------------------------------------------------------- app_settings ----
create policy app_settings_admin_select on public.app_settings
  for select to authenticated using (public.is_admin());
create policy app_settings_admin_update on public.app_settings
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- ------------------------------------------------------ email_allowlist ----
create policy email_allowlist_admin_all on public.email_allowlist
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ------------------------------------------------------------ sla_rules ----
create policy sla_rules_select on public.sla_rules
  for select to authenticated using (public.is_active_user());
create policy sla_rules_admin_write on public.sla_rules
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- -------------------------------------------------------- routing_rules ----
create policy routing_rules_select on public.routing_rules
  for select to authenticated using (public.is_active_user());
create policy routing_rules_admin_write on public.routing_rules
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- -------------------------------------------------------------- tickets ----
create policy tickets_select on public.tickets
  for select to authenticated
  using (public.is_agent() or (public.is_active_user() and created_by = auth.uid()));

create policy tickets_insert on public.tickets
  for insert to authenticated
  with check (public.is_active_user() and created_by = auth.uid());

-- Requesters pass this policy but the t20 guard trigger limits them to
-- confirming or reopening their own resolved ticket.
create policy tickets_update on public.tickets
  for update to authenticated
  using (public.is_agent() or (public.is_active_user() and created_by = auth.uid()))
  with check (public.is_agent() or (public.is_active_user() and created_by = auth.uid()));

-- ------------------------------------------------------ ticket_comments ----
create policy ticket_comments_select on public.ticket_comments
  for select to authenticated
  using (
    public.is_agent()
    or (
      public.is_active_user()
      and not is_internal
      and exists (select 1 from public.tickets t where t.id = ticket_id and t.created_by = auth.uid())
    )
  );

create policy ticket_comments_insert on public.ticket_comments
  for insert to authenticated
  with check (
    public.is_active_user()
    and author_id = auth.uid()
    and (
      public.is_agent()
      or (
        not is_internal
        and exists (select 1 from public.tickets t where t.id = ticket_id and t.created_by = auth.uid())
      )
    )
  );

-- -------------------------------------------------------- ticket_events ----
-- Read-only to clients; every row is written by a SECURITY DEFINER trigger.
create policy ticket_events_select on public.ticket_events
  for select to authenticated
  using (
    public.is_agent()
    or (
      public.is_active_user()
      and exists (select 1 from public.tickets t where t.id = ticket_id and t.created_by = auth.uid())
    )
  );

-- ----------------------------------------------------- notification_log ----
create policy notification_log_select on public.notification_log
  for select to authenticated using (public.is_agent());

-- ------------------------------------------------------------- realtime ----
alter publication supabase_realtime add table public.tickets;
alter publication supabase_realtime add table public.ticket_comments;
alter publication supabase_realtime add table public.ticket_events;
