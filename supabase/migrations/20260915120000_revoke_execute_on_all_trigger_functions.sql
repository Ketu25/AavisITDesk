-- The 20260830202400 lock-down revoked EXECUTE on trigger functions by name,
-- from a list written that day. `handle_auth_user_password_set()` was created
-- afterwards (20260830230000) and so was never in it — and a brand new
-- function is granted EXECUTE TO PUBLIC by default, which is how it ended up
-- reachable by `anon` over /rest/v1/rpc. (`create or replace` preserves grants,
-- which is why the functions that predate the lock-down stayed locked down.)
--
-- A hand-maintained list will drift again the next time a trigger is added, so
-- this revokes by shape rather than by name: nothing that returns `trigger` is
-- callable over the API, now or later. PostgreSQL checks EXECUTE when a trigger
-- is CREATED rather than when it fires, so no existing trigger is affected.
--
-- The immediate exposure was not exploitable — PostgreSQL refuses to call a
-- function returning `trigger` as an ordinary function, so the call errors
-- before the body runs — but "cannot be reached" is a better guarantee than
-- "reaching it happens to fail".
do $$
declare
  fn text;
begin
  for fn in
    select format('%I.%I(%s)', n.nspname, p.proname,
                  pg_get_function_identity_arguments(p.oid))
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prorettype = 'pg_catalog.trigger'::regtype
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
  end loop;
end;
$$;
