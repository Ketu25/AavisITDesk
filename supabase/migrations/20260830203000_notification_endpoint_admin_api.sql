-- private.notification_config is deliberately outside the exposed API, so give
-- admins a narrow, audited way to point the trigger at the deployed function.
-- The secret itself is never returned — only whether one is set.
create or replace function public.get_notification_endpoint()
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_cfg private.notification_config%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;

  select * into v_cfg from private.notification_config where id;

  return jsonb_build_object(
    'functions_base_url', v_cfg.functions_base_url,
    'secret_is_set', v_cfg.webhook_secret is not null and length(v_cfg.webhook_secret) > 0
  );
end;
$$;

create or replace function public.set_notification_endpoint(p_url text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;

  if p_url is not null and btrim(p_url) <> '' and p_url !~* '^https://' then
    raise exception 'The functions base URL must start with https://' using errcode = '22023';
  end if;

  update private.notification_config
     set functions_base_url = nullif(btrim(p_url), '')
   where id;

  return public.get_notification_endpoint();
end;
$$;

-- Rotating the shared secret invalidates any previously leaked value.
create or replace function public.rotate_notification_secret()
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_secret text;
begin
  if not public.is_admin() then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;

  v_secret := encode(gen_random_bytes(32), 'hex');
  update private.notification_config set webhook_secret = v_secret where id;

  -- Returned once so the admin can set it as the edge function's
  -- NOTIFY_WEBHOOK_SECRET; it is never readable again.
  return jsonb_build_object('webhook_secret', v_secret);
end;
$$;

revoke all on function public.get_notification_endpoint()      from public, anon;
revoke all on function public.set_notification_endpoint(text)  from public, anon;
revoke all on function public.rotate_notification_secret()     from public, anon;
grant execute on function public.get_notification_endpoint()     to authenticated;
grant execute on function public.set_notification_endpoint(text) to authenticated;
grant execute on function public.rotate_notification_secret()    to authenticated;
