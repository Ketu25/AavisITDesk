-- A closed ticket is terminal. Previously the insert policy checked who you
-- were but never what state the ticket was in, so a requester could keep
-- replying to a ticket they had already confirmed — and could do it straight
-- against PostgREST, not just through the UI.
--
-- Locking it here means the timeline can never show a reply that lands after
-- the closing event. An agent who needs to add something reopens the work
-- first (closed -> in_progress is already an allowed transition and is
-- recorded in ticket_events), which keeps the audit trail honest.
--
-- `resolved` is deliberately NOT locked: that is the window in which the
-- requester says "actually, this isn't fixed".

drop policy if exists ticket_comments_insert on public.ticket_comments;

create policy ticket_comments_insert on public.ticket_comments
  for insert to authenticated
  with check (
    public.is_active_user()
    and author_id = auth.uid()
    and exists (
      select 1
        from public.tickets t
       where t.id = ticket_id
         and t.status <> 'closed'
         and (public.is_agent() or t.created_by = auth.uid())
    )
    -- Internal notes stay agent-only.
    and (public.is_agent() or not is_internal)
  );
