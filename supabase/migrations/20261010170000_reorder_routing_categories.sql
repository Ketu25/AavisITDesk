-- Categories appear in sort_order everywhere they are listed: the routing
-- screen, the new-ticket form and the queue filter. Admins reorder them as a
-- whole list, so the write is whole-list too — one statement renumbering every
-- rule inside one transaction. Saving row by row from the browser would let
-- two admins dragging at the same time interleave into an order neither chose,
-- and a failure halfway would leave half a reorder behind.
create or replace function public.reorder_routing_rules(p_ids uuid[])
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_total integer;
begin
  if not public.is_admin() then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;

  -- Queues behind any other reorder, insert or delete still in flight, so the
  -- completeness check below cannot go stale before the update lands. Plain
  -- reads (the new-ticket form) are not blocked.
  lock table public.routing_rules in share row exclusive mode;

  select count(*) into v_total from public.routing_rules;

  -- The list must be exactly the current set of rules: every rule present,
  -- once. A list taken before someone else added or removed a category would
  -- otherwise silently drop the newcomer to wherever its old number lands.
  if p_ids is null
     or coalesce(cardinality(p_ids), 0) <> v_total
     or (select count(distinct r.id) from public.routing_rules r where r.id = any (p_ids)) <> v_total
  then
    raise exception 'The category list changed while you were reordering it. It has been reloaded — please try again.'
      using errcode = '22023';
  end if;

  update public.routing_rules r
     set sort_order = (o.position * 10)::integer
    from unnest(p_ids) with ordinality as o (id, position)
   where r.id = o.id
     and r.sort_order is distinct from (o.position * 10)::integer;
end;
$$;

revoke all on function public.reorder_routing_rules(uuid[]) from public, anon;
grant execute on function public.reorder_routing_rules(uuid[]) to authenticated;

-- Close up the gaps and ties the old "count + 1" numbering left behind
-- (deleting a category, then adding one, could hand two rules the same
-- number), keeping today's visible order.
with ranked as (
  select id, (row_number() over (order by sort_order, lower(category)) * 10)::integer as next
    from public.routing_rules
)
update public.routing_rules r
   set sort_order = ranked.next
  from ranked
 where r.id = ranked.id
   and r.sort_order is distinct from ranked.next;
