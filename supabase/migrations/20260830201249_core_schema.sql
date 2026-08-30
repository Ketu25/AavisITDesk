-- ============================================================================
-- AavisITDesk — core schema
-- Enums, configurable tables (departments / SLA / routing / settings),
-- profiles, tickets, comments and the immutable audit trail.
-- ============================================================================

create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------- enums ----
create type public.user_role      as enum ('user', 'agent', 'admin');
create type public.user_status    as enum ('pending', 'active', 'disabled');
create type public.ticket_priority as enum ('low', 'normal', 'high', 'urgent');
create type public.ticket_status  as enum (
  'new', 'assigned', 'in_progress', 'waiting_on_user', 'resolved', 'closed', 'reopened'
);

-- ---------------------------------------------------------- departments ----
-- Admin-managed. Never hardcode this list in application code.
create table public.departments (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  is_active   boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);
create unique index departments_name_unique on public.departments (lower(name));

-- ------------------------------------------------------------- profiles ----
-- One row per auth.users row. `status` gates every RLS policy in this schema:
-- a disabled user resolves to no role and therefore sees nothing.
create table public.profiles (
  id                  uuid primary key references auth.users (id) on delete cascade,
  email               text not null,
  full_name           text not null,
  department_id       uuid references public.departments (id) on delete set null,
  role                public.user_role   not null default 'user',
  status              public.user_status not null default 'pending',
  invited_by          uuid references public.profiles (id) on delete set null,
  invited_at          timestamptz,
  activated_at        timestamptz,
  last_invite_sent_at timestamptz,
  disabled_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create unique index profiles_email_unique on public.profiles (lower(email));
create index profiles_role_status_idx on public.profiles (role, status);
create index profiles_department_idx  on public.profiles (department_id);

-- --------------------------------------------------------- app_settings ----
-- Singleton row. Holds the email allow-list, notification targets and the
-- knobs that keep routing/escalation data-driven rather than hardcoded.
create table public.app_settings (
  id                            boolean primary key default true check (id),
  allowed_email_domains         text[] not null default '{}',
  invite_expiry_hours           integer not null default 48 check (invite_expiry_hours between 1 and 720),
  teams_webhook_url             text,
  it_distribution_email         text,
  notify_email_enabled          boolean not null default true,
  notify_teams_enabled          boolean not null default true,
  auto_assign_strategy          text not null default 'off'
                                  check (auto_assign_strategy in ('off', 'round_robin', 'least_busy')),
  escalation_unassigned_minutes integer not null default 60,
  escalation_lead_id            uuid references public.profiles (id) on delete set null,
  app_base_url                  text,
  updated_at                    timestamptz not null default now(),
  updated_by                    uuid references public.profiles (id) on delete set null
);

-- ------------------------------------------------------ email_allowlist ----
-- Individual address exceptions to the domain allow-list, so an admin can
-- grant access to a contractor or a shared mailbox without opening a domain.
create table public.email_allowlist (
  id         uuid primary key default gen_random_uuid(),
  email      text not null,
  note       text,
  added_by   uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index email_allowlist_email_unique on public.email_allowlist (lower(email));

-- ------------------------------------------------------------ sla_rules ----
create table public.sla_rules (
  id                   uuid primary key default gen_random_uuid(),
  priority             public.ticket_priority not null unique,
  duration_minutes     integer not null check (duration_minutes > 0),
  at_risk_threshold_pct integer not null default 75 check (at_risk_threshold_pct between 1 and 99),
  updated_at           timestamptz not null default now()
);

-- -------------------------------------------------------- routing_rules ----
-- Doubles as the source of truth for the category dropdown.
create table public.routing_rules (
  id                    uuid primary key default gen_random_uuid(),
  category              text not null,
  description           text,
  default_assignee_id   uuid references public.profiles (id) on delete set null,
  default_department_id uuid references public.departments (id) on delete set null,
  default_priority      public.ticket_priority,
  is_active             boolean not null default true,
  sort_order            integer not null default 0,
  created_at            timestamptz not null default now()
);
create unique index routing_rules_category_unique on public.routing_rules (lower(category));

-- -------------------------------------------------------------- tickets ----
create sequence public.ticket_number_seq start 1000;

create table public.tickets (
  id             uuid primary key default gen_random_uuid(),
  ticket_number  text not null unique default ('AAV-' || nextval('public.ticket_number_seq')),
  created_by     uuid not null references public.profiles (id) on delete restrict,
  department_id  uuid references public.departments (id) on delete set null,
  category       text not null,
  subject        text not null check (length(btrim(subject)) between 3 and 160),
  description    text not null check (length(btrim(description)) >= 5),
  priority       public.ticket_priority not null default 'normal',
  status         public.ticket_status   not null default 'new',
  assigned_to    uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  work_started_at timestamptz,
  first_response_at timestamptz,
  resolved_at    timestamptz,
  closed_at      timestamptz,
  sla_due_at     timestamptz,
  sla_paused_at  timestamptz,
  reopen_count   integer not null default 0
);
create index tickets_status_idx      on public.tickets (status);
create index tickets_assigned_idx    on public.tickets (assigned_to);
create index tickets_creator_idx     on public.tickets (created_by);
create index tickets_department_idx  on public.tickets (department_id);
create index tickets_sla_due_idx     on public.tickets (sla_due_at);
create index tickets_created_at_idx  on public.tickets (created_at desc);

-- ------------------------------------------------------ ticket_comments ----
-- `is_internal` notes are visible to agents/admins only.
create table public.ticket_comments (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references public.tickets (id) on delete cascade,
  author_id   uuid references public.profiles (id) on delete set null,
  message     text not null check (length(btrim(message)) > 0),
  is_internal boolean not null default false,
  created_at  timestamptz not null default now()
);
create index ticket_comments_ticket_idx on public.ticket_comments (ticket_id, created_at);

-- -------------------------------------------------------- ticket_events ----
-- Append-only audit trail. Written by triggers only; no client insert policy.
create table public.ticket_events (
  id         uuid primary key default gen_random_uuid(),
  ticket_id  uuid not null references public.tickets (id) on delete cascade,
  actor_id   uuid references public.profiles (id) on delete set null,
  event_type text not null,
  from_value text,
  to_value   text,
  metadata   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index ticket_events_ticket_idx on public.ticket_events (ticket_id, created_at);

-- ----------------------------------------------------- notification_log ----
create table public.notification_log (
  id         uuid primary key default gen_random_uuid(),
  ticket_id  uuid references public.tickets (id) on delete cascade,
  channel    text not null check (channel in ('teams', 'email')),
  kind       text not null check (kind in ('new_ticket', 'escalation', 'sla_breach')),
  status     text not null check (status in ('pending', 'sent', 'failed', 'skipped')),
  detail     text,
  created_at timestamptz not null default now()
);
create index notification_log_ticket_idx on public.notification_log (ticket_id, created_at desc);
