-- An invite link is a single-use GET. Corporate mail security (Microsoft
-- Safe Links and friends) fetches URLs to scan them, which consumed the token
-- and confirmed the address before the human ever clicked. Because activation
-- keyed off email confirmation, the account flipped to `active` with no
-- password anyone knows — and "resend invite" then degraded to "send reset".
--
-- Confirming an address only proves a machine followed a link. Setting a
-- password proves a person arrived. Activation now keys off the latter.

alter table public.profiles
  add column if not exists password_set_at timestamptz;

comment on column public.profiles.password_set_at is
  'When the account holder actually chose a password. NULL means the invite '
  'has not truly been accepted, however the email got confirmed.';

-- Confirmation is still recorded, but it no longer activates anything.
create or replace function public.handle_auth_user_confirmed()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.email_confirmed_at is not null and old.email_confirmed_at is null then
    update public.profiles
       set updated_at = now()
     where id = new.id;
  end if;
  return new;
end;
$$;

-- The password hash is written at INSERT for an invited user (GoTrue stores a
-- placeholder), so only a *change* on UPDATE means the holder chose one.
create or replace function public.handle_auth_user_password_set()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.profiles
     set password_set_at = coalesce(password_set_at, now()),
         status = case
                    when status = 'disabled' then 'disabled'
                    else 'active'
                  end::public.user_status,
         activated_at = coalesce(activated_at, now()),
         updated_at = now()
   where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_password_set on auth.users;
create trigger on_auth_user_password_set
  after update of encrypted_password on auth.users
  for each row
  when (
    old.encrypted_password is distinct from new.encrypted_password
    and coalesce(new.encrypted_password, '') <> ''
  )
  execute function public.handle_auth_user_password_set();

-- A user created already-confirmed by an operator (bootstrap admin, seeded
-- test account) has a password from the start; one that was merely invited
-- does not, whatever its confirmation state.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_self_serve boolean := new.invited_at is null and new.email_confirmed_at is not null;
begin
  insert into public.profiles (
    id, email, full_name, department_id, role, status,
    invited_by, invited_at, last_invite_sent_at, activated_at, password_set_at
  ) values (
    new.id,
    lower(new.email),
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)),
    nullif(new.raw_user_meta_data ->> 'department_id', '')::uuid,
    coalesce(nullif(new.raw_user_meta_data ->> 'role', '')::public.user_role, 'user'),
    case when v_self_serve then 'active' else 'pending' end::public.user_status,
    nullif(new.raw_user_meta_data ->> 'invited_by', '')::uuid,
    coalesce(new.invited_at, now()),
    coalesce(new.invited_at, now()),
    case when v_self_serve then now() else null end,
    case when v_self_serve then now() else null end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Backfill: accounts whose holder genuinely chose a password.
update public.profiles p
   set password_set_at = coalesce(p.password_set_at, u.created_at)
  from auth.users u
 where u.id = p.id
   and u.invited_at is null;
