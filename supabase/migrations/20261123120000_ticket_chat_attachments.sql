-- ============================================================================
-- Screenshots in the ticket chat.
--
-- A reply can now carry up to five images — PNG, JPEG, GIF or WebP, 10 MB
-- each — and may be nothing but images. The browser uploads each file straight
-- to a private Storage bucket (the Worker never handles the bytes), then posts
-- the message naming what it uploaded. post_ticket_comment() writes the message
-- and its attachments in one transaction, so a reply never appears without its
-- images, and realtime never announces a message whose images are not there yet.
--
-- Who may see an image is not decided a second time here. An attachment is
-- visible exactly when its message is, so an internal note's screenshot stays
-- hidden from the requester by the same ticket_comments policy that hides the
-- note itself.
--
-- Files are named <ticket id>/<random uuid>.<ext>. The ticket folder is what
-- the upload policy checks; the random name means a path cannot be guessed.
-- ============================================================================

-- --------------------------------------------------------------- bucket ----
-- Private: every read goes through a signed URL issued under the reader's own
-- RLS. SVG is deliberately absent — it can carry script.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ticket-attachments', 'ticket-attachments', false, 10485760,
        array['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- --------------------------------------------------- ticket_attachments ----
-- `mime_type` and `size_bytes` are copied from the stored object by the
-- trigger below, never taken from the caller. `width`/`height` do come from
-- the browser, and are used for nothing but reserving space while it loads.
create table public.ticket_attachments (
  id           uuid primary key default gen_random_uuid(),
  ticket_id    uuid not null references public.tickets (id) on delete cascade,
  comment_id   uuid not null references public.ticket_comments (id) on delete cascade,
  uploaded_by  uuid references public.profiles (id) on delete set null,
  storage_path text not null unique,
  file_name    text not null check (length(btrim(file_name)) between 1 and 120),
  mime_type    text not null
                 check (mime_type in ('image/png', 'image/jpeg', 'image/gif', 'image/webp')),
  size_bytes   integer not null check (size_bytes between 1 and 10485760),
  width        integer check (width between 1 and 50000),
  height       integer check (height between 1 and 50000),
  -- 0–4 and unique per message: the five-image limit, held by the schema.
  position     smallint not null check (position between 0 and 4),
  created_at   timestamptz not null default now(),
  unique (comment_id, position)
);
create index ticket_attachments_ticket_idx on public.ticket_attachments (ticket_id);

create or replace function public.ticket_attachments_before_insert()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner    text;
  v_metadata jsonb;
begin
  select o.owner_id, o.metadata
    into v_owner, v_metadata
    from storage.objects o
   where o.bucket_id = 'ticket-attachments'
     and o.name = new.storage_path;

  -- The file must exist, be the caller's own upload, and sit in this ticket's
  -- folder — otherwise anyone could attach a file they found the name of.
  if not found
     or v_owner is distinct from new.uploaded_by::text
     or split_part(new.storage_path, '/', 1) <> new.ticket_id::text then
    raise exception 'That image was not uploaded to this ticket. Remove it and attach it again.'
      using errcode = '22023';
  end if;

  new.mime_type  := v_metadata ->> 'mimetype';
  new.size_bytes := (v_metadata ->> 'size')::integer;
  new.created_at := now();

  if new.storage_path !~ ('\.' || case new.mime_type
                                    when 'image/png'  then 'png'
                                    when 'image/jpeg' then 'jpg'
                                    when 'image/gif'  then 'gif'
                                    when 'image/webp' then 'webp'
                                    else '-'
                                  end || '$') then
    raise exception 'That file is not a supported image. Attach a PNG, JPEG, GIF or WebP.'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

create trigger t10_ticket_attachments_before_insert
  before insert on public.ticket_attachments
  for each row execute function public.ticket_attachments_before_insert();

-- ---------------------------------------- a message may be only images ----
-- The old CHECK demanded text. A check cannot look at another table, so the
-- rule "text, or at least one image" is a constraint trigger deferred to
-- commit — by then post_ticket_comment() has written the attachments too.
-- A bare empty insert straight against PostgREST still fails.
alter table public.ticket_comments drop constraint ticket_comments_message_check;

create or replace function public.ticket_comments_require_content()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if length(btrim(new.message)) = 0
     and not exists (select 1 from public.ticket_attachments a where a.comment_id = new.id) then
    raise exception 'Write something or attach an image first.' using errcode = '23514';
  end if;
  return null;
end;
$$;

create constraint trigger t95_ticket_comments_require_content
  after insert or update of message on public.ticket_comments
  deferrable initially deferred
  for each row execute function public.ticket_comments_require_content();

-- ------------------------------------------------------------ helpers ----
create or replace function public.ticket_attachment_is_linked(p_name text)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.ticket_attachments where storage_path = p_name);
$$;

/**
 * May the caller upload `p_name` into the bucket? Only into the folder of a
 * ticket they could reply to — open, and theirs unless they are an agent —
 * under a name of the expected shape. Unsent uploads are capped per day, so
 * the bucket cannot be filled through the Storage API directly.
 */
create or replace function public.ticket_attachment_upload_allowed(p_name text)
returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_name is null
     or p_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|gif|webp)$'
     or not public.is_active_user() then
    return false;
  end if;

  if not exists (
    select 1
      from public.tickets t
     where t.id = split_part(p_name, '/', 1)::uuid
       and t.status <> 'closed'
       and (public.is_agent() or t.created_by = auth.uid())
  ) then
    return false;
  end if;

  return (
    select count(*)
      from storage.objects o
     where o.bucket_id = 'ticket-attachments'
       and o.owner_id = auth.uid()::text
       and o.created_at > now() - interval '1 day'
       and not exists (select 1 from public.ticket_attachments a where a.storage_path = o.name)
  ) < 30;
end;
$$;

-- ------------------------------------------------------------- posting ----
/**
 * Writes a reply and its images as one unit. SECURITY INVOKER on purpose: the
 * message goes through the existing ticket_comments insert policy unchanged —
 * closed tickets, internal notes, whose ticket it is — rather than a copy of
 * those rules that could drift from them.
 */
create or replace function public.post_ticket_comment(
  p_ticket_id   uuid,
  p_message     text,
  p_is_internal boolean default false,
  p_attachments jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_comment public.ticket_comments;
  v_count   integer;
begin
  if p_attachments is null or jsonb_typeof(p_attachments) <> 'array' then
    raise exception 'Attachments must be a list.' using errcode = '22023';
  end if;

  v_count := jsonb_array_length(p_attachments);
  if v_count > 5 then
    raise exception 'A message can carry up to 5 images.' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_message, ''))) = 0 and v_count = 0 then
    raise exception 'Write something or attach an image first.' using errcode = '22023';
  end if;

  insert into public.ticket_comments (ticket_id, author_id, message, is_internal)
  values (p_ticket_id, auth.uid(), coalesce(p_message, ''), coalesce(p_is_internal, false))
  returning * into v_comment;

  insert into public.ticket_attachments
    (ticket_id, comment_id, uploaded_by, storage_path, file_name, width, height, position)
  select p_ticket_id, v_comment.id, auth.uid(),
         item ->> 'path', item ->> 'name',
         (item ->> 'width')::integer, (item ->> 'height')::integer,
         (ord - 1)::smallint
    from jsonb_array_elements(p_attachments) with ordinality as a (item, ord);

  return jsonb_build_object('id', v_comment.id, 'created_at', v_comment.created_at);
end;
$$;

-- ------------------------------------------------------------------ RLS ----
alter table public.ticket_attachments enable row level security;

-- Visible exactly when the message is: ticket_comments' own policy decides.
create policy ticket_attachments_select on public.ticket_attachments
  for select to authenticated
  using (exists (select 1 from public.ticket_comments c where c.id = comment_id));

-- Only onto the caller's own message, written in this same transaction. Every
-- PostgREST request is its own transaction and `now()` is the transaction's
-- start, so outside post_ticket_comment() no client can create a message and
-- attach to it at once — nor add images to a message already sent.
create policy ticket_attachments_insert on public.ticket_attachments
  for insert to authenticated
  with check (
    public.is_active_user()
    and uploaded_by = auth.uid()
    and exists (
      select 1
        from public.ticket_comments c
       where c.id = comment_id
         and c.ticket_id = ticket_attachments.ticket_id
         and c.author_id = auth.uid()
         and c.created_at = now()
    )
  );

-- No update or delete policy: an attachment is as permanent as its message.

-- ------------------------------------------------------ storage policies ----
create policy ticket_attachments_upload on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'ticket-attachments'
    and public.ticket_attachment_upload_allowed(name)
  );

-- A sent image is readable by whoever can read its message. The uploader can
-- also see their own upload before it is sent: Storage reads the row back
-- after inserting it, and removing an abandoned upload needs it too.
create policy ticket_attachments_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'ticket-attachments'
    and (
      exists (select 1 from public.ticket_attachments a where a.storage_path = objects.name)
      or (owner_id = auth.uid()::text and not public.ticket_attachment_is_linked(name))
    )
  );

-- Only an upload that never made it into a message can be removed — by its
-- uploader, when a send fails or they take the image back out. Sent images
-- cannot be deleted by anyone through the API. No update policy at all.
create policy ticket_attachments_discard on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'ticket-attachments'
    and owner_id = auth.uid()::text
    and not public.ticket_attachment_is_linked(name)
  );

-- ------------------------------------------------------------- grants ----
revoke all on function public.ticket_attachments_before_insert()         from public, anon, authenticated;
revoke all on function public.ticket_comments_require_content()          from public, anon, authenticated;
revoke all on function public.ticket_attachment_is_linked(text)          from public, anon;
revoke all on function public.ticket_attachment_upload_allowed(text)     from public, anon;
revoke all on function public.post_ticket_comment(uuid, text, boolean, jsonb) from public, anon;
-- The two helpers run inside storage policies, evaluated as the caller.
grant execute on function public.ticket_attachment_is_linked(text)       to authenticated;
grant execute on function public.ticket_attachment_upload_allowed(text)  to authenticated;
grant execute on function public.post_ticket_comment(uuid, text, boolean, jsonb) to authenticated;
