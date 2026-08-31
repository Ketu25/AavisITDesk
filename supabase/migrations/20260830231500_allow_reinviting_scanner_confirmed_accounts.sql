-- GoTrue refuses to invite an address it considers already registered, and a
-- link scanner can get an address confirmed without anyone setting a password.
-- That combination leaves an account permanently un-invitable.
--
-- This clears the confirmation so a fresh invite can be issued, and is
-- deliberately narrow: it refuses outright if the holder has ever set a
-- password, so it can never be used to hijack a live account.
--
-- auth.users.confirmed_at is GENERATED ALWAYS AS LEAST(email_confirmed_at,
-- phone_confirmed_at), so it must not be assigned; clearing email_confirmed_at
-- updates it on its own.
create or replace function public.reset_invite_state(p_user_id uuid)
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_password_set_at timestamptz;
begin
  select password_set_at into v_password_set_at
    from public.profiles where id = p_user_id;

  if not found then
    raise exception 'No such account.' using errcode = 'P0002';
  end if;

  if v_password_set_at is not null then
    raise exception 'That account already has a password; send a reset link instead.'
      using errcode = '42501';
  end if;

  update auth.users
     set email_confirmed_at = null,
         confirmation_token = '',
         updated_at         = now()
   where id = p_user_id;

  return true;
end;
$$;

revoke all on function public.reset_invite_state(uuid) from public, anon, authenticated;
grant execute on function public.reset_invite_state(uuid) to service_role;
