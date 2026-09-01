-- The previous design carried intent in auth user_metadata, but GoTrue does
-- not apply `password` and `data` in one row update: the password write lands
-- first and fires the trigger, and the metadata write follows milliseconds
-- later. The trigger therefore always read stale intent.
--
-- Intent is now irrelevant. Activation is granted only when the stored
-- password hash differs from the one recorded when the temporary password was
-- issued — proof that the holder actually replaced it. A session cannot fake
-- that by calling an endpoint.

alter table public.profiles
  add column if not exists temp_password_fingerprint text;

comment on column public.profiles.temp_password_fingerprint is
  'Digest of the password hash at the moment a temporary password was issued. '
  'Activation requires the current hash to differ from this.';

create or replace function public.stamp_temp_password(
  p_user_id  uuid,
  p_expires  timestamptz
)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_hash text;
begin
  select encrypted_password into v_hash from auth.users where id = p_user_id;

  update public.profiles
     set status                    = case when status = 'disabled' then 'disabled' else 'pending' end::public.user_status,
         must_change_password      = true,
         password_set_at           = null,
         activated_at              = null,
         temp_password_expires_at  = p_expires,
         temp_password_fingerprint = md5(coalesce(v_hash, '')),
         last_invite_sent_at       = now(),
         updated_at                = now()
   where id = p_user_id;
end;
$$;

revoke all on function public.stamp_temp_password(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.stamp_temp_password(uuid, timestamptz) to service_role;

-- The password-change trigger no longer decides activation for accounts on a
-- temporary password; it only keeps ordinary resets tidy.
create or replace function public.handle_auth_user_password_set()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.profiles
     set password_set_at = coalesce(password_set_at, now()),
         status = case when status = 'disabled' then 'disabled' else 'active' end::public.user_status,
         activated_at = coalesce(activated_at, now()),
         updated_at = now()
   where id = new.id
     and not must_change_password;
  return new;
end;
$$;
