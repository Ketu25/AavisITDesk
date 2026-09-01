-- complete_activation() runs SECURITY DEFINER, but auth.uid() is still the
-- caller's, so profiles_guard correctly saw "a non-admin changing status" and
-- refused. The guard now honours a transaction-local bypass, set only inside
-- that function — the same pattern auto_assign_ticket already uses.
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

  if public.is_admin()
     or auth.uid() is null
     or coalesce(current_setting('app.bypass_profile_guard', true), 'off') = 'on' then
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

-- Called by the holder's own session after they set a new password. Refuses
-- unless the stored password hash has genuinely changed.
create or replace function public.complete_activation()
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_profile public.profiles%rowtype;
  v_hash    text;
begin
  select * into v_profile from public.profiles where id = auth.uid();

  if not found then
    raise exception 'You are not signed in.' using errcode = '42501';
  end if;
  if v_profile.status = 'disabled' then
    raise exception 'This account is disabled.' using errcode = '42501';
  end if;

  if not v_profile.must_change_password then
    return jsonb_build_object('status', v_profile.status, 'changed', false);
  end if;

  if v_profile.temp_password_expires_at is not null
     and v_profile.temp_password_expires_at < now() then
    raise exception 'That temporary password has expired. Ask IT to issue a new one.'
      using errcode = '42501';
  end if;

  select encrypted_password into v_hash from auth.users where id = auth.uid();

  if v_profile.temp_password_fingerprint is not null
     and md5(coalesce(v_hash, '')) = v_profile.temp_password_fingerprint then
    raise exception 'Set a new password before continuing.' using errcode = '42501';
  end if;

  -- Only this one statement is exempted, and only for the caller's own row.
  perform set_config('app.bypass_profile_guard', 'on', true);

  update public.profiles
     set status                    = 'active',
         must_change_password      = false,
         password_set_at           = coalesce(password_set_at, now()),
         activated_at              = coalesce(activated_at, now()),
         temp_password_expires_at  = null,
         temp_password_fingerprint = null,
         updated_at                = now()
   where id = auth.uid();

  perform set_config('app.bypass_profile_guard', 'off', true);

  return jsonb_build_object('status', 'active', 'changed', true);
end;
$$;

revoke all on function public.complete_activation() from public, anon;
grant execute on function public.complete_activation() to authenticated;
