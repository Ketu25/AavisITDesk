-- pgcrypto lives in the `extensions` schema, which is not on this function's
-- locked-down search_path, so digest() has to be schema-qualified.
create or replace function public.verify_notification_secret(p_secret text)
returns boolean
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare
  v_expected text;
begin
  select webhook_secret into v_expected from private.notification_config where id;
  if v_expected is null or p_secret is null then
    return false;
  end if;
  -- Compare digests rather than the raw values so the comparison time does
  -- not depend on how many leading characters matched.
  return extensions.digest(v_expected, 'sha256') = extensions.digest(p_secret, 'sha256');
end;
$$;

revoke all on function public.verify_notification_secret(text) from public, anon, authenticated;
grant execute on function public.verify_notification_secret(text) to service_role;
