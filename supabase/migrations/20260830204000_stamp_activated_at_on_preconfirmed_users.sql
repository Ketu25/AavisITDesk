-- A user created already-confirmed (bootstrap admin, or a pre-verified import)
-- never passes through the confirm trigger, so stamp activated_at up front.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.profiles (
    id, email, full_name, department_id, role, status,
    invited_by, invited_at, last_invite_sent_at, activated_at
  ) values (
    new.id,
    lower(new.email),
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)),
    nullif(new.raw_user_meta_data ->> 'department_id', '')::uuid,
    coalesce(nullif(new.raw_user_meta_data ->> 'role', '')::public.user_role, 'user'),
    case when new.email_confirmed_at is not null then 'active' else 'pending' end::public.user_status,
    nullif(new.raw_user_meta_data ->> 'invited_by', '')::uuid,
    coalesce(new.invited_at, now()),
    coalesce(new.invited_at, now()),
    case when new.email_confirmed_at is not null then now() else null end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

update public.profiles
   set activated_at = coalesce(activated_at, created_at)
 where status = 'active' and activated_at is null;
