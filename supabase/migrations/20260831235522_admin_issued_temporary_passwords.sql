-- Supabase's built-in mailer allows only a couple of messages an hour, which
-- makes email-delivered invites unusable for onboarding ~100 people. Admins now
-- create the account with a temporary password and hand it over out of band.
--
-- The account is deliberately NOT usable until the holder replaces that
-- password: it stays `pending`, so is_active_user() is false and every RLS
-- policy fails closed. The only thing a pending session can do is set a new
-- password.

alter table public.profiles
  add column if not exists must_change_password     boolean not null default false,
  add column if not exists temp_password_expires_at timestamptz;

comment on column public.profiles.must_change_password is
  'True while the account is still on an admin-issued temporary password. The '
  'holder can authenticate but cannot use the app until they replace it.';

comment on column public.profiles.temp_password_expires_at is
  'When the temporary password stops being accepted. An unused credential '
  'should not stay valid forever.';

create or replace function public.temp_password_is_valid(p_user_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (
      select not p.must_change_password
             or p.temp_password_expires_at is null
             or p.temp_password_expires_at > now()
        from public.profiles p
       where p.id = p_user_id
    ),
    false
  );
$$;

revoke all on function public.temp_password_is_valid(uuid) from public, anon;
grant execute on function public.temp_password_is_valid(uuid) to authenticated, service_role;
