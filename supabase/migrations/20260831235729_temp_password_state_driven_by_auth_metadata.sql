-- Creates the profile in the right state for a temporary-password account.
--
-- NOTE: the password-change half of this approach turned out to be unsound and
-- is replaced by 20260901000637 — GoTrue does not apply `password` and `data`
-- in one row update, so a trigger reading user_metadata always saw stale
-- intent. The profile-creation half below is still the live definition: an
-- INSERT carries the marker reliably because there is only one write.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_temp boolean := coalesce((new.raw_user_meta_data ->> 'must_change_password')::boolean, false);
  -- Created directly by an operator with a password already set, and not
  -- carrying a temporary-password marker.
  v_self_serve boolean := new.invited_at is null
                          and new.email_confirmed_at is not null
                          and not v_temp;
begin
  insert into public.profiles (
    id, email, full_name, department_id, role, status,
    invited_by, invited_at, last_invite_sent_at,
    activated_at, password_set_at, must_change_password
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
    case when v_self_serve then now() else null end,
    v_temp
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
