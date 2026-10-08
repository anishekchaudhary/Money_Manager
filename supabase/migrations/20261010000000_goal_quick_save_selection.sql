-- Goals may be open-ended, and monthly saving is optional.
alter table public.goals alter column target_paise drop not null;
alter table public.goals alter column monthly_contribution_paise drop not null;

-- Keep the two-argument RPC for older clients. The Goals page uses this
-- explicit selection overload so unchecked goals receive nothing.
create function public.quick_save(p_account_id uuid, p_amount_paise bigint, p_goal_ids uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := (select auth.uid());
  v_count integer;
  v_balance bigint;
  v_reserved bigint;
  v_goal record;
  v_base bigint;
  v_remainder bigint;
  v_piece bigint;
  v_existing bigint;
  v_changes jsonb := '[]'::jsonb;
begin
  if not (select public.is_app_owner()) then raise exception 'Not authorized'; end if;
  if p_amount_paise is null or p_amount_paise <= 0 then raise exception 'Amount must be positive'; end if;
  if p_goal_ids is null or cardinality(p_goal_ids) = 0 then raise exception 'Select at least one active goal'; end if;

  perform 1 from public.accounts
    where owner_id = v_owner and id = p_account_id and active
      and kind in ('cash', 'bank')
      and opening_on <= (now() at time zone 'Asia/Kolkata')::date
    for update;
  if not found then raise exception 'Choose an active cash or bank account'; end if;

  select count(*) into v_count from public.goals
    where owner_id = v_owner and status = 'active' and id = any(p_goal_ids);
  if v_count <> cardinality(p_goal_ids) then
    raise exception 'Selected goals must be unique active goals owned by you';
  end if;

  select opening_balance_paise + coalesce((
    select sum(delta_paise) from public.entries
    where owner_id = v_owner and account_id = p_account_id
  ), 0)::bigint into v_balance
  from public.accounts where owner_id = v_owner and id = p_account_id;
  select coalesce(sum(cash_amount_paise), 0)::bigint into v_reserved
  from public.goal_allocations where owner_id = v_owner and account_id = p_account_id;
  if p_amount_paise > v_balance - v_reserved then
    raise exception 'Not enough unreserved money in the selected account';
  end if;

  v_base := p_amount_paise / v_count;
  v_remainder := p_amount_paise % v_count;
  for v_goal in
    select id, row_number() over (order by name, id) as position
    from public.goals
    where owner_id = v_owner and status = 'active' and id = any(p_goal_ids)
  loop
    v_piece := v_base + case when v_goal.position <= v_remainder then 1 else 0 end;
    if v_piece = 0 then continue; end if;
    select coalesce(cash_amount_paise, 0) into v_existing
    from public.goal_allocations
    where owner_id = v_owner and goal_id = v_goal.id and account_id = p_account_id;
    v_changes := v_changes || jsonb_build_array(jsonb_build_object(
      'goal_id', v_goal.id,
      'account_id', p_account_id,
      'cash_amount_paise', coalesce(v_existing, 0) + v_piece
    ));
  end loop;
  perform private.apply_allocation_changes(v_owner, v_changes, 'quick_save');
  return v_changes;
end;
$$;
revoke all on function public.quick_save(uuid, bigint, uuid[]) from public, anon, authenticated;
grant execute on function public.quick_save(uuid, bigint, uuid[]) to authenticated;
