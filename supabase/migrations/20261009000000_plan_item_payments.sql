-- Link a confirmed expense to exactly one monthly plan line. This column is
-- deliberately not an FK: backup restore inserts transactions before plan items.
-- The owner-only RPC below validates ownership, month, account and category.
alter table public.transactions add column plan_item_id uuid;
create index transactions_plan_item_id_idx on public.transactions(owner_id, plan_item_id)
  where plan_item_id is not null;

create or replace function public.record_plan_item_payment(
  p_plan_item_id uuid,
  p_transaction_id uuid,
  p_occurred_on date,
  p_amount_paise bigint,
  p_payment_method text default null,
  p_note text default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := (select auth.uid());
  v_item public.plan_items%rowtype;
  v_plan public.monthly_plans%rowtype;
  v_existing public.transactions%rowtype;
begin
  if not (select public.is_app_owner()) then raise exception 'Not authorized'; end if;
  if p_transaction_id is null or p_amount_paise is null or p_amount_paise <= 0 then
    raise exception 'A positive actual amount and transaction ID are required';
  end if;
  select * into v_item from public.plan_items
  where owner_id = v_owner and id = p_plan_item_id for update;
  if not found then raise exception 'Planned item not found'; end if;
  select * into v_plan from public.monthly_plans
  where owner_id = v_owner and id = v_item.plan_id;
  if v_plan.status <> 'active' then raise exception 'Activate the monthly plan before recording a payment'; end if;
  if p_occurred_on is null or date_trunc('month', p_occurred_on)::date <> v_plan.month_start then
    raise exception 'Payment date must be in the planned month';
  end if;
  if v_item.kind not in ('fixed_expense', 'variable_expense') or v_item.recurring_template_id is not null then
    raise exception 'Use a standalone expense plan line; linked recurring items are paid in Recurring';
  end if;
  if v_item.funding_account_id is null or v_item.category_id is null then
    raise exception 'Choose a funding account and expense category first';
  end if;
  select * into v_existing from public.transactions
  where owner_id = v_owner and id = p_transaction_id;
  if found then
    if v_existing.plan_item_id = p_plan_item_id
      and v_existing.occurred_on = p_occurred_on
      and v_existing.amount_paise = p_amount_paise
      and v_existing.payment_method is not distinct from p_payment_method
      and v_existing.note is not distinct from coalesce(p_note, v_item.name) then
      return p_transaction_id;
    end if;
    raise exception 'Transaction ID already used for a different payment';
  end if;
  if exists (
    select 1 from public.transactions t
    where t.owner_id = v_owner and t.plan_item_id = p_plan_item_id
      and t.kind = 'expense'
      and not exists (
        select 1 from public.transactions reversal
        where reversal.owner_id = v_owner and reversal.reverses_transaction_id = t.id
      )
  ) then raise exception 'This planned item is already marked used'; end if;
  perform public.post_transaction(
    p_id => p_transaction_id,
    p_occurred_on => p_occurred_on,
    p_kind => 'expense',
    p_amount_paise => p_amount_paise,
    p_source_account_id => v_item.funding_account_id,
    p_category_id => v_item.category_id,
    p_note => coalesce(p_note, v_item.name),
    p_payment_method => p_payment_method
  );
  update public.transactions set plan_item_id = p_plan_item_id
  where owner_id = v_owner and id = p_transaction_id;
  return p_transaction_id;
end;
$$;
revoke all on function public.record_plan_item_payment(uuid, uuid, date, bigint, text, text)
  from public, anon, authenticated;
grant execute on function public.record_plan_item_payment(uuid, uuid, date, bigint, text, text)
  to authenticated;

-- Associate an already-recorded expense without moving money a second time.
create or replace function public.link_plan_item_transaction(
  p_plan_item_id uuid, p_transaction_id uuid
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := (select auth.uid());
  v_item public.plan_items%rowtype;
  v_month date;
  v_transaction public.transactions%rowtype;
begin
  if not (select public.is_app_owner()) then raise exception 'Not authorized'; end if;
  select * into v_item from public.plan_items
  where owner_id = v_owner and id = p_plan_item_id for update;
  if not found or v_item.kind not in ('fixed_expense', 'variable_expense')
    or v_item.recurring_template_id is not null then
    raise exception 'Choose a standalone expense plan line';
  end if;
  select month_start into v_month from public.monthly_plans
  where owner_id = v_owner and id = v_item.plan_id;
  select * into v_transaction from public.transactions
  where owner_id = v_owner and id = p_transaction_id for update;
  if not found or v_transaction.kind <> 'expense'
    or v_transaction.plan_item_id is not null
    or v_transaction.category_id is distinct from v_item.category_id
    or date_trunc('month', v_transaction.occurred_on)::date <> v_month
    or (v_item.funding_account_id is not null
        and v_transaction.source_account_id is distinct from v_item.funding_account_id)
    or exists (select 1 from public.transactions r
      where r.owner_id = v_owner and r.reverses_transaction_id = p_transaction_id)
    or exists (select 1 from public.recurring_occurrences o
      where o.owner_id = v_owner and o.actual_transaction_id = p_transaction_id) then
    raise exception 'This transaction cannot be linked to the planned item';
  end if;
  if exists (
    select 1 from public.transactions t
    where t.owner_id = v_owner and t.plan_item_id = p_plan_item_id
      and not exists (select 1 from public.transactions r
        where r.owner_id = v_owner and r.reverses_transaction_id = t.id)
  ) then raise exception 'This planned item already has a payment'; end if;
  update public.transactions set plan_item_id = p_plan_item_id
  where owner_id = v_owner and id = p_transaction_id;
end;
$$;
revoke all on function public.link_plan_item_transaction(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.link_plan_item_transaction(uuid, uuid)
  to authenticated;
