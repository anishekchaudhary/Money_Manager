-- Personal Money Management PWA: private, single-owner schema.
-- Run this migration in each Supabase project before connecting the app.
-- After creating and verifying the sole Auth user, run ONCE in SQL Editor:
--   insert into public.app_owner (owner_id)
--   values ('<the UUID from Authentication > Users>'::uuid);
-- Then disable new sign-ups in Authentication settings. Never put a service-role
-- key or database password in a browser, repository, or Vercel public variable.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.app_owner (
  singleton boolean primary key default true check (singleton),
  owner_id uuid not null unique references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create or replace function public.is_app_owner()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (select 1 from public.app_owner where owner_id = (select auth.uid()));
$$;
revoke all on function public.is_app_owner() from public, anon, authenticated;
grant execute on function public.is_app_owner() to authenticated;

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id),
  name text not null check (length(btrim(name)) between 1 and 100),
  kind text not null check (kind in ('cash', 'bank', 'card', 'loan', 'investment')),
  opening_on date not null default ((now() at time zone 'Asia/Kolkata')::date)
    check (opening_on <= ((now() at time zone 'Asia/Kolkata')::date)),
  opening_balance_paise bigint not null default 0 check (opening_balance_paise >= 0),
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  unique (owner_id, id),
  unique (owner_id, name)
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id),
  name text not null check (length(btrim(name)) between 1 and 100),
  kind text not null check (kind in ('income', 'expense')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  unique (owner_id, id),
  unique (owner_id, kind, name)
);

-- Entry delta is in the account's natural direction: an asset increase is
-- positive; an increase in card/loan debt is also positive. Net worth sums
-- assets and subtracts liabilities. Opening balances are not income.
create table public.transactions (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users(id),
  occurred_on date not null,
  kind text not null check (kind in (
    'income', 'expense', 'transfer', 'investment_contribution',
    'card_payment', 'loan_payment', 'adjustment_increase',
    'adjustment_decrease', 'reversal'
  )),
  amount_paise bigint not null check (amount_paise > 0),
  interest_paise bigint not null default 0 check (interest_paise >= 0),
  source_account_id uuid,
  destination_account_id uuid,
  category_id uuid,
  payment_method text,
  note text,
  allocation_changes jsonb not null default '[]'::jsonb,
  goal_id uuid,
  reverses_transaction_id uuid,
  created_at timestamptz not null default now(),
  unique (owner_id, id),
  unique (owner_id, reverses_transaction_id),
  foreign key (owner_id, source_account_id) references public.accounts(owner_id, id),
  foreign key (owner_id, destination_account_id) references public.accounts(owner_id, id),
  foreign key (owner_id, category_id) references public.categories(owner_id, id),
  foreign key (owner_id, reverses_transaction_id)
    references public.transactions(owner_id, id),
  check (kind = 'reversal' or source_account_id is distinct from destination_account_id),
  check (interest_paise <= amount_paise),
  check (jsonb_typeof(allocation_changes) = 'array')
);
create index transactions_owner_date_idx on public.transactions(owner_id, occurred_on desc, created_at desc);

create table public.entries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  transaction_id uuid not null,
  account_id uuid not null,
  delta_paise bigint not null check (delta_paise <> 0),
  created_at timestamptz not null default now(),
  unique (owner_id, transaction_id, account_id),
  foreign key (owner_id, transaction_id) references public.transactions(owner_id, id) on delete restrict,
  foreign key (owner_id, account_id) references public.accounts(owner_id, id) on delete restrict
);
create index entries_account_idx on public.entries(owner_id, account_id, transaction_id);

create table public.investment_valuations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id),
  account_id uuid not null,
  as_of_date date not null,
  market_value_paise bigint not null check (market_value_paise >= 0),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  unique (owner_id, id),
  unique (owner_id, account_id, as_of_date),
  foreign key (owner_id, account_id) references public.accounts(owner_id, id) on delete restrict
);
create index investment_valuations_latest_idx on public.investment_valuations(owner_id, account_id, as_of_date desc);

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id),
  name text not null check (length(btrim(name)) between 1 and 100),
  target_paise bigint not null check (target_paise > 0),
  target_on date,
  monthly_contribution_paise bigint not null default 0 check (monthly_contribution_paise >= 0),
  status text not null default 'active' check (status in ('active', 'paused', 'completed', 'archived')),
  completed_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  unique (owner_id, id),
  unique (owner_id, name)
);

alter table public.transactions
  add constraint transactions_goal_owner_fk foreign key (owner_id, goal_id)
  references public.goals(owner_id, id);

-- Cash allocations are paise reserved in a cash/bank account. Investment
-- allocations are shares in parts per million: 1,000,000 = the full holding.
-- Goal funding may exceed target_paise by design.
create table public.goal_allocations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id),
  goal_id uuid not null,
  account_id uuid not null,
  cash_amount_paise bigint,
  investment_share_ppm integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  unique (owner_id, id),
  unique (owner_id, goal_id, account_id),
  foreign key (owner_id, goal_id) references public.goals(owner_id, id) on delete restrict,
  foreign key (owner_id, account_id) references public.accounts(owner_id, id) on delete restrict,
  check (
    (cash_amount_paise > 0 and investment_share_ppm is null) or
    (cash_amount_paise is null and investment_share_ppm between 1 and 1000000)
  )
);
create index goal_allocations_account_idx on public.goal_allocations(owner_id, account_id);

create table public.goal_allocation_changes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  goal_id uuid not null,
  account_id uuid not null,
  transaction_id uuid,
  reason text not null check (reason in ('manual', 'quick_save', 'transfer', 'goal_completion', 'correction')),
  old_cash_amount_paise bigint,
  new_cash_amount_paise bigint,
  old_investment_share_ppm integer,
  new_investment_share_ppm integer,
  effective_on date not null default ((now() at time zone 'Asia/Kolkata')::date),
  created_at timestamptz not null default now(),
  foreign key (owner_id, goal_id) references public.goals(owner_id, id),
  foreign key (owner_id, account_id) references public.accounts(owner_id, id),
  foreign key (owner_id, transaction_id) references public.transactions(owner_id, id)
);
create index goal_allocation_changes_goal_idx on public.goal_allocation_changes(owner_id, goal_id, created_at desc);

create table public.monthly_plans (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id),
  month_start date not null check (extract(day from month_start) = 1),
  source_plan_id uuid,
  status text not null default 'draft' check (status in ('draft', 'active')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  unique (owner_id, id),
  unique (owner_id, month_start),
  foreign key (owner_id, source_plan_id) references public.monthly_plans(owner_id, id)
);

create table public.recurring_templates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id),
  name text not null check (length(btrim(name)) between 1 and 100),
  kind text not null check (kind in ('income', 'expense', 'transfer', 'investment_contribution', 'card_payment', 'loan_payment')),
  amount_paise bigint not null check (amount_paise > 0),
  interest_paise bigint not null default 0 check (interest_paise >= 0 and interest_paise <= amount_paise),
  due_day integer not null check (due_day between 1 and 31),
  starts_on date not null,
  ends_on date,
  source_account_id uuid,
  destination_account_id uuid,
  category_id uuid,
  goal_id uuid,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  unique (owner_id, id),
  foreign key (owner_id, source_account_id) references public.accounts(owner_id, id),
  foreign key (owner_id, destination_account_id) references public.accounts(owner_id, id),
  foreign key (owner_id, category_id) references public.categories(owner_id, id),
  foreign key (owner_id, goal_id) references public.goals(owner_id, id),
  check (ends_on is null or ends_on >= starts_on)
);

create table public.plan_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id),
  plan_id uuid not null,
  name text not null check (length(btrim(name)) between 1 and 100),
  kind text not null check (kind in ('income', 'fixed_expense', 'variable_expense', 'saving', 'investment')),
  planned_paise bigint not null check (planned_paise >= 0),
  due_day integer check (due_day between 1 and 31),
  category_id uuid,
  goal_id uuid,
  account_id uuid,
  recurring_template_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  unique (owner_id, id),
  foreign key (owner_id, plan_id) references public.monthly_plans(owner_id, id) on delete cascade,
  foreign key (owner_id, category_id) references public.categories(owner_id, id),
  foreign key (owner_id, goal_id) references public.goals(owner_id, id),
  foreign key (owner_id, account_id) references public.accounts(owner_id, id),
  foreign key (owner_id, recurring_template_id) references public.recurring_templates(owner_id, id)
);
create unique index plan_items_one_template_per_month_idx
  on public.plan_items(owner_id, plan_id, recurring_template_id)
  where recurring_template_id is not null;

create table public.recurring_occurrences (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id),
  template_id uuid not null,
  month_start date not null check (extract(day from month_start) = 1),
  due_on date not null,
  expected_amount_paise bigint not null check (expected_amount_paise > 0),
  status text not null default 'pending' check (status in ('pending', 'completed', 'skipped')),
  actual_transaction_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  unique (owner_id, id),
  unique (owner_id, template_id, month_start),
  unique (owner_id, actual_transaction_id),
  foreign key (owner_id, template_id) references public.recurring_templates(owner_id, id),
  foreign key (owner_id, actual_transaction_id) references public.transactions(owner_id, id),
  check ((status = 'completed') = (actual_transaction_id is not null))
);

create table public.alert_states (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id),
  alert_key text not null check (length(btrim(alert_key)) between 1 and 250),
  state text not null check (state in ('dismissed', 'snoozed')),
  snoozed_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  unique (owner_id, id),
  unique (owner_id, alert_key),
  check ((state = 'snoozed') = (snoozed_until is not null))
);

create table public.goal_completions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  goal_id uuid not null,
  total_spent_paise bigint not null check (total_spent_paise > 0),
  note text,
  request_payments jsonb not null,
  request_allocation_changes jsonb not null,
  completed_at timestamptz not null default now(),
  unique (owner_id, id),
  unique (owner_id, goal_id),
  foreign key (owner_id, goal_id) references public.goals(owner_id, id)
);
create table public.goal_completion_payments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  completion_id uuid not null,
  transaction_id uuid not null,
  payment_method text not null,
  foreign key (owner_id, completion_id) references public.goal_completions(owner_id, id),
  foreign key (owner_id, transaction_id) references public.transactions(owner_id, id),
  unique (owner_id, transaction_id)
);

create or replace function private.touch_version()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.id is distinct from old.id or new.owner_id is distinct from old.owner_id then
    raise exception 'Record identity cannot be changed';
  end if;
  new.created_at := old.created_at;
  new.updated_at := now();
  new.version := old.version + 1;
  return new;
end;
$$;

create or replace function private.guard_account_update()
returns trigger language plpgsql set search_path = '' as $$
declare v_reserved bigint;
begin
  if (new.opening_balance_paise is distinct from old.opening_balance_paise
      or new.opening_on is distinct from old.opening_on
      or new.kind is distinct from old.kind)
    and exists (select 1 from public.entries
                where owner_id = old.owner_id and account_id = old.id) then
    raise exception 'Opening balance, opening date, and kind cannot change after transactions';
  end if;
  if new.kind is distinct from old.kind
    and (exists (select 1 from public.goal_allocations
                 where owner_id = old.owner_id and account_id = old.id)
      or exists (select 1 from public.investment_valuations
                 where owner_id = old.owner_id and account_id = old.id)) then
    raise exception 'Account kind cannot change after allocations or valuations';
  end if;
  if new.opening_balance_paise is distinct from old.opening_balance_paise then
    select coalesce(sum(cash_amount_paise), 0)::bigint into v_reserved
    from public.goal_allocations
    where owner_id = old.owner_id and account_id = old.id;
    if new.opening_balance_paise < v_reserved then
      raise exception 'Opening balance cannot be below goal reservations';
    end if;
  end if;
  return new;
end;
$$;
create trigger guard_account_update before update on public.accounts
for each row execute function private.guard_account_update();

create or replace function private.guard_goal_completion()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status = 'completed' and old.status <> 'completed'
    and not exists (select 1 from public.goal_completions
      where owner_id = old.owner_id and goal_id = old.id) then
    raise exception 'Use complete_goal to record spending and finish a goal';
  end if;
  return new;
end;
$$;
create trigger guard_goal_completion before update on public.goals
for each row execute function private.guard_goal_completion();

do $$
declare t text;
begin
  foreach t in array array[
    'accounts', 'categories', 'investment_valuations', 'goals',
    'goal_allocations', 'monthly_plans', 'recurring_templates',
    'plan_items', 'recurring_occurrences', 'alert_states'
  ] loop
    execute format('create trigger touch_version before update on public.%I for each row execute function private.touch_version()', t);
  end loop;
end $$;

-- Only the predesignated Auth user may access application rows. Financial
-- ledger and allocation tables are read-only from the browser; definer RPCs
-- implement multi-row writes with validation and atomicity.
do $$
declare t text;
begin
  foreach t in array array[
    'app_owner', 'accounts', 'categories', 'transactions', 'entries',
    'investment_valuations', 'goals', 'goal_allocations',
    'goal_allocation_changes', 'monthly_plans', 'plan_items',
    'recurring_templates', 'recurring_occurrences', 'alert_states',
    'goal_completions', 'goal_completion_payments'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format(
      'create policy owner_read on public.%I for select to authenticated using (owner_id = (select auth.uid()) and (select public.is_app_owner()))',
      t
    );
  end loop;
  foreach t in array array[
    'accounts', 'categories', 'investment_valuations', 'goals',
    'monthly_plans', 'plan_items', 'recurring_templates',
    'alert_states'
  ] loop
    execute format('grant insert, update, delete on public.%I to authenticated', t);
    execute format(
      'create policy owner_insert on public.%I for insert to authenticated with check (owner_id = (select auth.uid()) and (select public.is_app_owner()))',
      t
    );
    execute format(
      'create policy owner_update on public.%I for update to authenticated using (owner_id = (select auth.uid()) and (select public.is_app_owner())) with check (owner_id = (select auth.uid()) and (select public.is_app_owner()))',
      t
    );
    execute format(
      'create policy owner_delete on public.%I for delete to authenticated using (owner_id = (select auth.uid()) and (select public.is_app_owner()))',
      t
    );
  end loop;
end $$;

-- A cash/bank balance or card/loan debt is its opening amount plus entries.
-- Investment holdings use the most recent manual valuation for current market
-- value, then apply entries dated after that valuation; entries on the same
-- date apply only if they were recorded after the valuation. Before any
-- valuation, invested book balance is used as provisional current value.
create or replace function public.account_book_balance_paise(p_account_id uuid)
returns bigint language sql stable security invoker set search_path = '' as $$
  select a.opening_balance_paise + coalesce(sum(e.delta_paise), 0)::bigint
  from public.accounts a
  left join public.entries e on e.owner_id = a.owner_id and e.account_id = a.id
  where a.id = p_account_id and a.owner_id = (select auth.uid())
    and (select public.is_app_owner())
  group by a.id, a.opening_balance_paise;
$$;
revoke all on function public.account_book_balance_paise(uuid) from public, anon, authenticated;
grant execute on function public.account_book_balance_paise(uuid) to authenticated;

create or replace function public.investment_market_value_paise(p_account_id uuid)
returns bigint language plpgsql stable security invoker set search_path = '' as $$
declare
  v_owner uuid := (select auth.uid());
  v_book bigint;
  v_value bigint;
  v_as_of date;
  v_recorded_at timestamptz;
  v_post_valuation bigint;
begin
  if not (select public.is_app_owner()) then return null; end if;
  select public.account_book_balance_paise(p_account_id)
  into v_book
  from public.accounts a
  where a.id = p_account_id and a.owner_id = v_owner and a.kind = 'investment';
  if not found then return null; end if;
  select iv.market_value_paise, iv.as_of_date, iv.created_at
  into v_value, v_as_of, v_recorded_at
  from public.investment_valuations iv
  where iv.owner_id = v_owner and iv.account_id = p_account_id
  order by iv.as_of_date desc, iv.created_at desc limit 1;
  if not found then return v_book; end if;
  select coalesce(sum(e.delta_paise), 0)::bigint into v_post_valuation
  from public.entries e join public.transactions tx
    on tx.id = e.transaction_id and tx.owner_id = e.owner_id
  where e.owner_id = v_owner and e.account_id = p_account_id
    and (tx.occurred_on > v_as_of
      or (tx.occurred_on = v_as_of and tx.created_at > v_recorded_at));
  return v_value + v_post_valuation;
end;
$$;
revoke all on function public.investment_market_value_paise(uuid) from public, anon, authenticated;
grant execute on function public.investment_market_value_paise(uuid) to authenticated;

-- Validate that a recorded valuation belongs to an investment account.
create or replace function private.validate_investment_valuation()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.as_of_date > (now() at time zone 'Asia/Kolkata')::date then
    raise exception 'Investment valuation cannot be dated in the future';
  end if;
  if not exists (select 1 from public.accounts
                 where id = new.account_id and owner_id = new.owner_id and kind = 'investment') then
    raise exception 'Valuations require an investment account';
  end if;
  return new;
end;
$$;
create trigger validate_investment_valuation
before insert or update on public.investment_valuations
for each row execute function private.validate_investment_valuation();

-- p_changes is an array of final values. A zero/null value removes an
-- allocation. All affected account rows are locked so concurrent saves and
-- ledger posts cannot both spend or reserve the same cash.
create or replace function private.apply_allocation_changes(
  p_owner uuid, p_changes jsonb, p_reason text,
  p_transaction_id uuid default null,
  p_effective_on date default ((now() at time zone 'Asia/Kolkata')::date)
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_change jsonb;
  v_goal uuid;
  v_account uuid;
  v_cash bigint;
  v_share integer;
  v_kind text;
  v_old public.goal_allocations%rowtype;
  v_old_found boolean;
  v_seen text[] := '{}';
  v_key text;
  v_account_id uuid;
  v_reserved bigint;
  v_balance bigint;
  v_total_share bigint;
begin
  if jsonb_typeof(p_changes) <> 'array' then
    raise exception 'Allocation changes must be an array';
  end if;
  if p_reason not in ('manual', 'quick_save', 'transfer', 'goal_completion', 'correction') then
    raise exception 'Unknown allocation change reason';
  end if;
  if jsonb_array_length(p_changes) = 0 then return; end if;

  -- Sort locks to avoid deadlocks when two devices change multiple accounts.
  for v_account_id in
    select distinct (x.value->>'account_id')::uuid
    from jsonb_array_elements(p_changes) x
    order by 1
  loop
    perform 1 from public.accounts
    where owner_id = p_owner and id = v_account_id for update;
    if not found then raise exception 'Allocation account not found'; end if;
  end loop;

  for v_change in select value from jsonb_array_elements(p_changes) loop
    v_goal := (v_change->>'goal_id')::uuid;
    v_account := (v_change->>'account_id')::uuid;
    if v_goal is null or v_account is null then
      raise exception 'Each allocation change needs a goal_id and account_id';
    end if;
    v_key := v_goal::text || ':' || v_account::text;
    if v_key = any(v_seen) then raise exception 'Duplicate allocation change for %', v_key; end if;
    v_seen := array_append(v_seen, v_key);

    if not exists (select 1 from public.goals where owner_id = p_owner and id = v_goal) then
      raise exception 'Allocation goal not found';
    end if;
    select kind into v_kind from public.accounts where owner_id = p_owner and id = v_account;
    v_cash := nullif(v_change->>'cash_amount_paise', '')::bigint;
    v_share := nullif(v_change->>'investment_share_ppm', '')::integer;
    if coalesce(v_cash, 0) < 0 or coalesce(v_share, 0) < 0 then
      raise exception 'Allocation cannot be negative';
    end if;
    if v_kind in ('cash', 'bank') then
      if coalesce(v_share, 0) <> 0 then raise exception 'Cash account cannot have investment share'; end if;
      v_share := null;
    elsif v_kind = 'investment' then
      if coalesce(v_cash, 0) <> 0 then raise exception 'Investment account cannot have cash allocation'; end if;
      v_cash := null;
    else
      raise exception 'Goals can use only cash, bank, or investment accounts';
    end if;

    select * into v_old from public.goal_allocations
      where owner_id = p_owner and goal_id = v_goal and account_id = v_account for update;
    v_old_found := found;
    if coalesce(v_cash, 0) = 0 and coalesce(v_share, 0) = 0 then
      if not v_old_found then continue; end if;
      delete from public.goal_allocations where id = v_old.id;
    elsif v_old_found then
      if v_old.cash_amount_paise is not distinct from v_cash
         and v_old.investment_share_ppm is not distinct from v_share then
        continue;
      end if;
      update public.goal_allocations
      set cash_amount_paise = v_cash, investment_share_ppm = v_share
      where id = v_old.id;
    else
      insert into public.goal_allocations
        (owner_id, goal_id, account_id, cash_amount_paise, investment_share_ppm)
      values (p_owner, v_goal, v_account, v_cash, v_share);
    end if;
    insert into public.goal_allocation_changes (
      owner_id, goal_id, account_id, transaction_id, reason,
      old_cash_amount_paise, new_cash_amount_paise,
      old_investment_share_ppm, new_investment_share_ppm, effective_on
    ) values (
      p_owner, v_goal, v_account, p_transaction_id, p_reason,
      case when v_old_found then v_old.cash_amount_paise end,
      nullif(v_cash, 0),
      case when v_old_found then v_old.investment_share_ppm end,
      nullif(v_share, 0), p_effective_on
    );
  end loop;

  for v_account_id in
    select distinct (x.value->>'account_id')::uuid
    from jsonb_array_elements(p_changes) x
  loop
    select kind into v_kind from public.accounts
      where owner_id = p_owner and id = v_account_id;
    if v_kind in ('cash', 'bank') then
      select coalesce(sum(cash_amount_paise), 0)::bigint into v_reserved
      from public.goal_allocations where owner_id = p_owner and account_id = v_account_id;
      select opening_balance_paise + coalesce((
        select sum(delta_paise) from public.entries
        where owner_id = p_owner and account_id = v_account_id
      ), 0)::bigint into v_balance
      from public.accounts where owner_id = p_owner and id = v_account_id;
      if v_reserved > v_balance then
        raise exception 'Goal reservations exceed account balance';
      end if;
    else
      select coalesce(sum(investment_share_ppm), 0)::bigint into v_total_share
      from public.goal_allocations where owner_id = p_owner and account_id = v_account_id;
      if v_total_share > 1000000 then
        raise exception 'Investment allocation exceeds 100 percent';
      end if;
    end if;
  end loop;
end;
$$;
revoke all on function private.apply_allocation_changes(uuid, jsonb, text, uuid, date)
  from public, anon, authenticated;

create or replace function public.set_goal_allocations(
  p_changes jsonb, p_reason text default 'manual',
  p_effective_on date default ((now() at time zone 'Asia/Kolkata')::date)
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (select public.is_app_owner()) then raise exception 'Not authorized'; end if;
  perform private.apply_allocation_changes((select auth.uid()), p_changes, p_reason, null, p_effective_on);
end;
$$;
revoke all on function public.set_goal_allocations(jsonb, text, date) from public, anon, authenticated;
grant execute on function public.set_goal_allocations(jsonb, text, date) to authenticated;

create or replace function public.quick_save(p_account_id uuid, p_amount_paise bigint)
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
  perform 1 from public.accounts
    where owner_id = v_owner and id = p_account_id and active
      and kind in ('cash', 'bank')
      and opening_on <= (now() at time zone 'Asia/Kolkata')::date
    for update;
  if not found then raise exception 'Choose an active cash or bank account'; end if;
  select count(*) into v_count from public.goals
    where owner_id = v_owner and status = 'active';
  if v_count = 0 then raise exception 'Add an active goal first'; end if;
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
    from public.goals where owner_id = v_owner and status = 'active'
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
revoke all on function public.quick_save(uuid, bigint) from public, anon, authenticated;
grant execute on function public.quick_save(uuid, bigint) to authenticated;

-- A transfer moves the same fraction of every cash goal allocation as the
-- fraction of the source account moved. Thus unreserved cash moves in the same
-- proportion. Largest remainders assign any leftover paise deterministically.
-- When the destination is an investment, existing shares are diluted by the
-- contribution and moved cash becomes a share of the expanded holding.
create or replace function private.move_transfer_allocations(
  p_owner uuid, p_transaction_id uuid, p_source uuid, p_destination uuid,
  p_destination_kind text, p_amount_paise bigint,
  p_source_before_paise bigint, p_dest_market_before_paise bigint,
  p_effective_on date
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_row record;
  v_changes jsonb := '[]'::jsonb;
  v_moves jsonb := '[]'::jsonb;
  v_old_dest_cash bigint;
  v_old_share integer;
  v_new_share bigint;
  v_moved bigint;
begin
  if p_source_before_paise <= 0 then raise exception 'Source account has no money to transfer'; end if;
  for v_row in
    with allocation as (
      select goal_id, cash_amount_paise,
        cash_amount_paise::numeric * p_amount_paise / p_source_before_paise as exact_move
      from public.goal_allocations
      where owner_id = p_owner and account_id = p_source
    ), portions as (
      select goal_id, cash_amount_paise,
        floor(exact_move)::bigint as base,
        exact_move - floor(exact_move) as fraction,
        floor(sum(cash_amount_paise) over ()::numeric
          * p_amount_paise / p_source_before_paise)::bigint as target
      from allocation
    ), ranked as (
      select *, row_number() over (order by fraction desc, goal_id) as position,
        sum(base) over () as base_total
      from portions
    )
    select goal_id, cash_amount_paise,
      base + case when position <= target - base_total then 1 else 0 end as moved
    from ranked
  loop
    if v_row.moved <= 0 then continue; end if;
    v_moves := v_moves || jsonb_build_array(jsonb_build_object(
      'goal_id', v_row.goal_id, 'moved_paise', v_row.moved
    ));
    v_changes := v_changes || jsonb_build_array(jsonb_build_object(
      'goal_id', v_row.goal_id, 'account_id', p_source,
      'cash_amount_paise', v_row.cash_amount_paise - v_row.moved
    ));
    if p_destination_kind in ('cash', 'bank') then
      select cash_amount_paise into v_old_dest_cash
      from public.goal_allocations
      where owner_id = p_owner and goal_id = v_row.goal_id
        and account_id = p_destination;
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'goal_id', v_row.goal_id, 'account_id', p_destination,
        'cash_amount_paise', coalesce(v_old_dest_cash, 0) + v_row.moved
      ));
    end if;
  end loop;

  if p_destination_kind = 'investment' then
    for v_row in
      select distinct goal_id from (
        select goal_id from public.goal_allocations
        where owner_id = p_owner and account_id = p_destination
        union all
        select (x.value->>'goal_id')::uuid as goal_id
        from jsonb_array_elements(v_moves) x
      ) affected
      order by goal_id
    loop
      select investment_share_ppm into v_old_share
      from public.goal_allocations
      where owner_id = p_owner and goal_id = v_row.goal_id
        and account_id = p_destination;
      select (x.value->>'moved_paise')::bigint into v_moved
      from jsonb_array_elements(v_moves) x
      where (x.value->>'goal_id')::uuid = v_row.goal_id;
      v_new_share := floor((coalesce(v_old_share, 0)::numeric
        * p_dest_market_before_paise + coalesce(v_moved, 0)::numeric * 1000000)
        / (p_dest_market_before_paise + p_amount_paise))::bigint;
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'goal_id', v_row.goal_id, 'account_id', p_destination,
        'investment_share_ppm', v_new_share
      ));
    end loop;
  end if;

  perform private.apply_allocation_changes(
    p_owner, v_changes, 'transfer', p_transaction_id, p_effective_on
  );
end;
$$;
revoke all on function private.move_transfer_allocations(
  uuid, uuid, uuid, uuid, text, bigint, bigint, bigint, date
) from public, anon, authenticated;

-- The only ledger write API. A client UUID is the idempotency key, including
-- for transactions queued by an offline PWA. Account entries and any explicit
-- allocation changes commit in the same database transaction.
create or replace function public.post_transaction(
  p_id uuid,
  p_occurred_on date,
  p_kind text,
  p_amount_paise bigint,
  p_source_account_id uuid default null,
  p_destination_account_id uuid default null,
  p_category_id uuid default null,
  p_note text default null,
  p_interest_paise bigint default 0,
  p_allocation_changes jsonb default '[]'::jsonb,
  p_payment_method text default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := (select auth.uid());
  v_source_kind text;
  v_dest_kind text;
  v_category_kind text;
  v_source_before bigint;
  v_dest_market_before bigint := 0;
  v_source_after bigint;
  v_reserved bigint;
  v_existing public.transactions%rowtype;
  v_inserted integer;
  v_changes jsonb := coalesce(p_allocation_changes, '[]'::jsonb);
begin
  if not (select public.is_app_owner()) then raise exception 'Not authorized'; end if;
  if p_id is null or p_occurred_on is null or p_amount_paise is null or p_amount_paise <= 0 then
    raise exception 'Transaction ID, date, and positive amount are required';
  end if;
  if p_occurred_on > (now() at time zone 'Asia/Kolkata')::date then
    raise exception 'Actual transactions cannot be dated in the future';
  end if;
  if p_interest_paise is null or p_interest_paise < 0 or p_interest_paise > p_amount_paise then
    raise exception 'Invalid interest amount';
  end if;
  if jsonb_typeof(v_changes) <> 'array' then
    raise exception 'Allocation changes must be an array';
  end if;
  if p_source_account_id is not null and p_source_account_id = p_destination_account_id then
    raise exception 'Source and destination must differ';
  end if;

  select * into v_existing from public.transactions where id = p_id;
  if found then
    if v_existing.owner_id <> v_owner
      or v_existing.occurred_on is distinct from p_occurred_on
      or v_existing.kind is distinct from p_kind
      or v_existing.amount_paise is distinct from p_amount_paise
      or v_existing.interest_paise is distinct from p_interest_paise
      or v_existing.source_account_id is distinct from p_source_account_id
      or v_existing.destination_account_id is distinct from p_destination_account_id
      or v_existing.category_id is distinct from p_category_id
      or v_existing.note is distinct from p_note
      or v_existing.payment_method is distinct from p_payment_method
      or v_existing.allocation_changes is distinct from v_changes then
      raise exception 'Idempotency key already belongs to different transaction';
    end if;
    return p_id;
  end if;

  -- Serialize changes to the affected accounts in a stable lock order.
  perform 1 from public.accounts
  where owner_id = v_owner and id in (p_source_account_id, p_destination_account_id)
  order by id for update;
  if p_source_account_id is not null then
    select kind into v_source_kind from public.accounts
    where owner_id = v_owner and id = p_source_account_id
      and active and opening_on <= p_occurred_on;
    if not found then raise exception 'Source account is missing, inactive, or not yet open'; end if;
    select opening_balance_paise + coalesce((
      select sum(delta_paise) from public.entries
      where owner_id = v_owner and account_id = p_source_account_id
    ), 0)::bigint into v_source_before
    from public.accounts where owner_id = v_owner and id = p_source_account_id;
  end if;
  if p_destination_account_id is not null then
    select kind into v_dest_kind from public.accounts
    where owner_id = v_owner and id = p_destination_account_id
      and active and opening_on <= p_occurred_on;
    if not found then raise exception 'Destination account is missing, inactive, or not yet open'; end if;
    if v_dest_kind = 'investment' then
      v_dest_market_before := public.investment_market_value_paise(p_destination_account_id);
    end if;
  end if;
  if p_category_id is not null then
    select kind into v_category_kind from public.categories
    where owner_id = v_owner and id = p_category_id and active;
    if not found then raise exception 'Category not found or archived'; end if;
  end if;

  if p_kind = 'income' then
    if p_source_account_id is not null or coalesce(v_dest_kind, '') not in ('cash', 'bank')
      or v_category_kind is distinct from 'income' or p_interest_paise <> 0 then
      raise exception 'Income needs a cash/bank destination and income category';
    end if;
  elsif p_kind = 'expense' then
    if p_destination_account_id is not null
      or coalesce(v_source_kind, '') not in ('cash', 'bank', 'card', 'investment')
      or v_category_kind is distinct from 'expense' or p_interest_paise <> 0 then
      raise exception 'Expense needs a source account and expense category';
    end if;
    if v_source_kind = 'investment'
      and public.investment_market_value_paise(p_source_account_id) < p_amount_paise then
      raise exception 'Investment market value is below expense amount';
    end if;
  elsif p_kind in ('transfer', 'investment_contribution') then
    if coalesce(v_source_kind, '') not in ('cash', 'bank')
      or coalesce(v_dest_kind, '') not in ('cash', 'bank', 'investment')
      or p_category_id is not null or p_interest_paise <> 0 then
      raise exception 'Transfer needs cash/bank source and cash/bank/investment destination';
    end if;
    if p_kind = 'investment_contribution' and v_dest_kind <> 'investment' then
      raise exception 'Investment contribution needs an investment destination';
    end if;
    -- Proportional goal movement uses the balances and allocations locked NOW.
    -- Replaying that movement at an earlier date would misstate goal history
    -- once either account has ever had a reservation or investment valuation.
    -- Such transfers must be dated today; use a reviewed correction workflow
    -- for older activity. With no such interactions, a backdated transfer may
    -- still be entered and ordinary balances/reports are recalculated.
    if p_occurred_on < (now() at time zone 'Asia/Kolkata')::date
      and (
        exists (select 1 from public.goal_allocations ga
          where ga.owner_id = v_owner
            and ga.account_id in (p_source_account_id, p_destination_account_id))
        or exists (select 1 from public.goal_allocation_changes gac
          where gac.owner_id = v_owner
            and gac.account_id in (p_source_account_id, p_destination_account_id))
        or exists (select 1 from public.investment_valuations iv
          where iv.owner_id = v_owner
            and iv.account_id in (p_source_account_id, p_destination_account_id))
      ) then
      raise exception 'Backdated transfer conflicts with goal or valuation history; use today or review a correction';
    end if;
    if jsonb_array_length(v_changes) > 0 then
      raise exception 'Transfer allocation movement is automatic';
    end if;
  elsif p_kind in ('card_payment', 'loan_payment') then
    if coalesce(v_source_kind, '') not in ('cash', 'bank')
      or (p_category_id is not null and p_kind = 'card_payment') then
      raise exception 'Card payment needs a cash/bank source';
    end if;
    if p_kind = 'card_payment' and (v_dest_kind is distinct from 'card' or p_interest_paise <> 0) then
      raise exception 'Card payment needs a card destination and no interest split';
    end if;
    if p_kind = 'loan_payment' and
       (v_dest_kind is distinct from 'loan' or
        (p_interest_paise > 0 and v_category_kind is distinct from 'expense')) then
      raise exception 'Loan payment needs a loan destination and interest expense category';
    end if;
  elsif p_kind in ('adjustment_increase', 'adjustment_decrease') then
    if p_source_account_id is null or p_destination_account_id is not null
       or p_category_id is not null or p_interest_paise <> 0 then
      raise exception 'Adjustment needs one account and no category';
    end if;
  else
    raise exception 'Unknown transaction kind';
  end if;

  insert into public.transactions (
    id, owner_id, occurred_on, kind, amount_paise, interest_paise,
    source_account_id, destination_account_id, category_id, payment_method,
    note, allocation_changes
  ) values (
    p_id, v_owner, p_occurred_on, p_kind, p_amount_paise, p_interest_paise,
    p_source_account_id, p_destination_account_id, p_category_id,
    p_payment_method, p_note, v_changes
  ) on conflict (id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    -- Concurrent retry committed while this call was waiting for the key.
    select * into v_existing from public.transactions where id = p_id;
    if not found or v_existing.owner_id <> v_owner
      or v_existing.occurred_on is distinct from p_occurred_on
      or v_existing.kind is distinct from p_kind
      or v_existing.amount_paise is distinct from p_amount_paise
      or v_existing.interest_paise is distinct from p_interest_paise
      or v_existing.source_account_id is distinct from p_source_account_id
      or v_existing.destination_account_id is distinct from p_destination_account_id
      or v_existing.category_id is distinct from p_category_id
      or v_existing.note is distinct from p_note
      or v_existing.payment_method is distinct from p_payment_method
      or v_existing.allocation_changes is distinct from v_changes then
      raise exception 'Idempotency key already belongs to different transaction';
    end if;
    return p_id;
  end if;

  if p_kind = 'income' then
    insert into public.entries(owner_id, transaction_id, account_id, delta_paise)
      values (v_owner, p_id, p_destination_account_id, p_amount_paise);
  elsif p_kind = 'expense' then
    insert into public.entries(owner_id, transaction_id, account_id, delta_paise)
      values (v_owner, p_id, p_source_account_id,
        case when v_source_kind = 'card' then p_amount_paise else -p_amount_paise end);
  elsif p_kind in ('transfer', 'investment_contribution') then
    insert into public.entries(owner_id, transaction_id, account_id, delta_paise)
      values (v_owner, p_id, p_source_account_id, -p_amount_paise),
             (v_owner, p_id, p_destination_account_id, p_amount_paise);
    perform private.move_transfer_allocations(
      v_owner, p_id, p_source_account_id, p_destination_account_id,
      v_dest_kind, p_amount_paise, v_source_before, v_dest_market_before,
      p_occurred_on
    );
  elsif p_kind = 'card_payment' then
    insert into public.entries(owner_id, transaction_id, account_id, delta_paise)
      values (v_owner, p_id, p_source_account_id, -p_amount_paise),
             (v_owner, p_id, p_destination_account_id, -p_amount_paise);
  elsif p_kind = 'loan_payment' then
    insert into public.entries(owner_id, transaction_id, account_id, delta_paise)
      values (v_owner, p_id, p_source_account_id, -p_amount_paise);
    if p_amount_paise > p_interest_paise then
      insert into public.entries(owner_id, transaction_id, account_id, delta_paise)
        values (v_owner, p_id, p_destination_account_id,
          -(p_amount_paise - p_interest_paise));
    end if;
  else
    insert into public.entries(owner_id, transaction_id, account_id, delta_paise)
      values (v_owner, p_id, p_source_account_id,
        case when p_kind = 'adjustment_increase' then p_amount_paise else -p_amount_paise end);
  end if;

  if jsonb_array_length(v_changes) > 0 then
    perform private.apply_allocation_changes(v_owner, v_changes, 'manual', p_id, p_occurred_on);
  end if;

  if v_source_kind in ('cash', 'bank') then
    select opening_balance_paise + coalesce((
      select sum(delta_paise) from public.entries
      where owner_id = v_owner and account_id = p_source_account_id
    ), 0)::bigint into v_source_after
    from public.accounts where owner_id = v_owner and id = p_source_account_id;
    select coalesce(sum(cash_amount_paise), 0)::bigint into v_reserved
    from public.goal_allocations
    where owner_id = v_owner and account_id = p_source_account_id;
    if v_source_after < 0 then raise exception 'Insufficient account balance'; end if;
    if v_source_after < v_reserved then
      raise exception 'Release or move goal reservations before spending this money';
    end if;
  elsif v_source_kind in ('card', 'loan') and p_kind = 'adjustment_decrease' then
    if public.account_book_balance_paise(p_source_account_id) < 0 then
      raise exception 'Adjustment would make debt negative';
    end if;
  end if;
  if p_kind in ('card_payment', 'loan_payment')
     and public.account_book_balance_paise(p_destination_account_id) < 0 then
    raise exception 'Payment exceeds the debt balance';
  end if;
  return p_id;
end;
$$;
revoke all on function public.post_transaction(
  uuid, date, text, bigint, uuid, uuid, uuid, text, bigint, jsonb, text
) from public, anon, authenticated;
grant execute on function public.post_transaction(
  uuid, date, text, bigint, uuid, uuid, uuid, text, bigint, jsonb, text
) to authenticated;

-- Completion is one transaction even when multiple accounts/payment methods
-- are selected. The caller explicitly supplies all reservation releases or
-- reallocations; no priority among other goals and unreserved money is made.
create or replace function public.complete_goal(
  p_goal_id uuid, p_payments jsonb, p_allocation_changes jsonb,
  p_note text default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := (select auth.uid());
  v_goal public.goals%rowtype;
  v_existing public.goal_completions%rowtype;
  v_payment jsonb;
  v_payment_id uuid;
  v_account_id uuid;
  v_category_id uuid;
  v_amount bigint;
  v_method text;
  v_total bigint := 0;
  v_completion_id uuid;
  v_payments jsonb := coalesce(p_payments, '[]'::jsonb);
  v_changes jsonb := coalesce(p_allocation_changes, '[]'::jsonb);
begin
  if not (select public.is_app_owner()) then raise exception 'Not authorized'; end if;
  if jsonb_typeof(v_payments) <> 'array' or jsonb_array_length(v_payments) = 0 then
    raise exception 'Choose at least one payment';
  end if;
  if jsonb_typeof(v_changes) <> 'array' then
    raise exception 'Allocation changes must be an array';
  end if;
  select * into v_goal from public.goals
  where owner_id = v_owner and id = p_goal_id for update;
  if not found then raise exception 'Goal not found'; end if;
  select * into v_existing from public.goal_completions
  where owner_id = v_owner and goal_id = p_goal_id;
  if found then
    if v_existing.request_payments is distinct from v_payments
      or v_existing.request_allocation_changes is distinct from v_changes
      or v_existing.note is distinct from p_note then
      raise exception 'Goal already completed with different payment details';
    end if;
    return v_existing.id;
  end if;
  if v_goal.status not in ('active', 'paused') then
    raise exception 'Only an active or paused goal can be completed';
  end if;

  perform private.apply_allocation_changes(
    v_owner, v_changes, 'goal_completion', null,
    (now() at time zone 'Asia/Kolkata')::date
  );
  if exists (select 1 from public.goal_allocations
             where owner_id = v_owner and goal_id = p_goal_id) then
    raise exception 'Release or reassign all money reserved for this goal';
  end if;

  for v_payment in select value from jsonb_array_elements(v_payments) loop
    v_payment_id := (v_payment->>'id')::uuid;
    v_account_id := (v_payment->>'account_id')::uuid;
    v_category_id := (v_payment->>'category_id')::uuid;
    v_amount := (v_payment->>'amount_paise')::bigint;
    v_method := nullif(btrim(v_payment->>'payment_method'), '');
    if v_payment_id is null or v_account_id is null or v_category_id is null
      or v_amount is null or v_amount <= 0 or v_method is null then
      raise exception 'Every payment needs an ID, account, category, positive amount, and method';
    end if;
    perform public.post_transaction(
      p_id => v_payment_id,
      p_occurred_on => (now() at time zone 'Asia/Kolkata')::date,
      p_kind => 'expense',
      p_amount_paise => v_amount,
      p_source_account_id => v_account_id,
      p_category_id => v_category_id,
      p_note => p_note,
      p_payment_method => v_method
    );
    update public.transactions set goal_id = p_goal_id
      where owner_id = v_owner and id = v_payment_id;
    v_total := v_total + v_amount;
  end loop;

  insert into public.goal_completions (
    owner_id, goal_id, total_spent_paise, note,
    request_payments, request_allocation_changes
  ) values (
    v_owner, p_goal_id, v_total, p_note, v_payments, v_changes
  ) returning id into v_completion_id;
  for v_payment in select value from jsonb_array_elements(v_payments) loop
    insert into public.goal_completion_payments (
      owner_id, completion_id, transaction_id, payment_method
    ) values (
      v_owner, v_completion_id, (v_payment->>'id')::uuid,
      v_payment->>'payment_method'
    );
  end loop;
  update public.goals set status = 'completed', completed_at = now()
    where id = p_goal_id and owner_id = v_owner;
  return v_completion_id;
end;
$$;
revoke all on function public.complete_goal(uuid, jsonb, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.complete_goal(uuid, jsonb, jsonb, text)
  to authenticated;

create or replace function public.create_monthly_plan(
  p_month_start date, p_copy_previous boolean
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := (select auth.uid());
  v_existing uuid;
  v_source uuid;
  v_new uuid;
begin
  if not (select public.is_app_owner()) then raise exception 'Not authorized'; end if;
  if p_month_start is null or extract(day from p_month_start) <> 1 then
    raise exception 'Plan month must start on the first day';
  end if;
  select id into v_existing from public.monthly_plans
  where owner_id = v_owner and month_start = p_month_start;
  if found then return v_existing; end if;
  if p_copy_previous then
    select id into v_source from public.monthly_plans
    where owner_id = v_owner
      and month_start = (p_month_start - interval '1 month')::date;
    if not found then raise exception 'Previous month plan does not exist'; end if;
  end if;
  insert into public.monthly_plans(owner_id, month_start, source_plan_id, status)
  values (v_owner, p_month_start, v_source, 'draft')
  on conflict (owner_id, month_start) do nothing
  returning id into v_new;
  if v_new is null then
    select id into v_new from public.monthly_plans
    where owner_id = v_owner and month_start = p_month_start;
    return v_new;
  end if;
  if v_source is not null then
    insert into public.plan_items (
      owner_id, plan_id, name, kind, planned_paise, due_day,
      category_id, goal_id, account_id, recurring_template_id
    )
    select v_owner, v_new, name, kind, planned_paise, due_day,
      category_id, goal_id, account_id, recurring_template_id
    from public.plan_items where owner_id = v_owner and plan_id = v_source;
  end if;
  return v_new;
end;
$$;
revoke all on function public.create_monthly_plan(date, boolean)
  from public, anon, authenticated;
grant execute on function public.create_monthly_plan(date, boolean)
  to authenticated;

create or replace function public.ensure_recurring_occurrences(p_month_start date)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := (select auth.uid());
  v_count integer;
begin
  if not (select public.is_app_owner()) then raise exception 'Not authorized'; end if;
  if p_month_start is null or extract(day from p_month_start) <> 1 then
    raise exception 'Occurrence month must start on the first day';
  end if;
  insert into public.recurring_occurrences (
    owner_id, template_id, month_start, due_on, expected_amount_paise
  )
  select v_owner, t.id, p_month_start,
    least(p_month_start + (t.due_day - 1),
      (p_month_start + interval '1 month - 1 day')::date),
    t.amount_paise
  from public.recurring_templates t
  where t.owner_id = v_owner and t.active
    and t.starts_on <= (p_month_start + interval '1 month - 1 day')::date
    and (t.ends_on is null or t.ends_on >= p_month_start)
  on conflict (owner_id, template_id, month_start) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.ensure_recurring_occurrences(date)
  from public, anon, authenticated;
grant execute on function public.ensure_recurring_occurrences(date)
  to authenticated;

create or replace function public.record_recurring_payment(
  p_occurrence_id uuid, p_transaction_id uuid, p_occurred_on date,
  p_amount_paise bigint default null, p_note text default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := (select auth.uid());
  v_occurrence public.recurring_occurrences%rowtype;
  v_template public.recurring_templates%rowtype;
begin
  if not (select public.is_app_owner()) then raise exception 'Not authorized'; end if;
  select * into v_occurrence from public.recurring_occurrences
  where owner_id = v_owner and id = p_occurrence_id for update;
  if not found then raise exception 'Recurring occurrence not found'; end if;
  if v_occurrence.status = 'completed' then
    if v_occurrence.actual_transaction_id = p_transaction_id then
      return p_transaction_id;
    end if;
    raise exception 'Occurrence already paid by another transaction';
  end if;
  if v_occurrence.status = 'skipped' then
    raise exception 'Skipped occurrence must be restored before payment';
  end if;
  select * into v_template from public.recurring_templates
  where owner_id = v_owner and id = v_occurrence.template_id;
  if not found then raise exception 'Recurring template not found'; end if;
  perform public.post_transaction(
    p_id => p_transaction_id,
    p_occurred_on => p_occurred_on,
    p_kind => v_template.kind,
    p_amount_paise => coalesce(p_amount_paise, v_occurrence.expected_amount_paise),
    p_source_account_id => v_template.source_account_id,
    p_destination_account_id => v_template.destination_account_id,
    p_category_id => v_template.category_id,
    p_note => coalesce(p_note, v_template.name),
    p_interest_paise => v_template.interest_paise
  );
  update public.recurring_occurrences
  set status = 'completed', actual_transaction_id = p_transaction_id
  where id = p_occurrence_id and owner_id = v_owner;
  return p_transaction_id;
end;
$$;
revoke all on function public.record_recurring_payment(uuid, uuid, date, bigint, text)
  from public, anon, authenticated;
grant execute on function public.record_recurring_payment(uuid, uuid, date, bigint, text)
  to authenticated;

create or replace function public.set_recurring_occurrence_status(
  p_occurrence_id uuid, p_status text
)
returns void language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := (select auth.uid());
begin
  if not (select public.is_app_owner()) then raise exception 'Not authorized'; end if;
  if p_status not in ('pending', 'skipped') then
    raise exception 'Only pending or skipped can be set directly';
  end if;
  update public.recurring_occurrences set status = p_status
  where owner_id = v_owner and id = p_occurrence_id
    and status in ('pending', 'skipped');
  if not found then
    raise exception 'Occurrence is completed or not found';
  end if;
end;
$$;
revoke all on function public.set_recurring_occurrence_status(uuid, text)
  from public, anon, authenticated;
grant execute on function public.set_recurring_occurrence_status(uuid, text)
  to authenticated;

-- A reversal is a new immutable event that negates every original account
-- entry. Both rows remain in the audit ledger. Reports should use
-- effective_transactions, which omits the original once reversed.
create or replace function public.void_transaction(
  p_transaction_id uuid, p_reversal_id uuid,
  p_allocation_changes jsonb default '[]'::jsonb
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := (select auth.uid());
  v_original public.transactions%rowtype;
  v_existing public.transactions%rowtype;
  v_account record;
  v_balance bigint;
  v_reserved bigint;
  v_changes jsonb := coalesce(p_allocation_changes, '[]'::jsonb);
begin
  if not (select public.is_app_owner()) then raise exception 'Not authorized'; end if;
  if p_transaction_id is null or p_reversal_id is null then
    raise exception 'Original and reversal IDs are required';
  end if;
  if jsonb_typeof(v_changes) <> 'array' then
    raise exception 'Allocation changes must be an array';
  end if;
  select * into v_original from public.transactions
  where id = p_transaction_id and owner_id = v_owner for update;
  if not found or v_original.kind = 'reversal' then
    raise exception 'Original transaction not found';
  end if;
  if exists (select 1 from public.goal_completion_payments
             where owner_id = v_owner and transaction_id = p_transaction_id) then
    raise exception 'A goal-completion payment cannot be voided separately';
  end if;
  select * into v_existing from public.transactions
  where owner_id = v_owner and reverses_transaction_id = p_transaction_id;
  if found then
    if v_existing.id <> p_reversal_id
      or v_existing.allocation_changes is distinct from v_changes then
      raise exception 'Transaction is already reversed';
    end if;
    return p_reversal_id;
  end if;
  if exists (select 1 from public.goal_allocation_changes
             where owner_id = v_owner and transaction_id = p_transaction_id)
    and jsonb_array_length(v_changes) = 0 then
    raise exception 'Review and supply goal allocation changes for this reversal';
  end if;
  perform 1 from public.accounts
  where owner_id = v_owner and id in (
    select account_id from public.entries
    where owner_id = v_owner and transaction_id = p_transaction_id
  ) order by id for update;
  insert into public.transactions (
    id, owner_id, occurred_on, kind, amount_paise, interest_paise,
    note, allocation_changes, reverses_transaction_id
  ) values (
    p_reversal_id, v_owner, v_original.occurred_on, 'reversal',
    v_original.amount_paise, v_original.interest_paise,
    'Reversal of ' || p_transaction_id::text, v_changes, p_transaction_id
  );
  insert into public.entries(owner_id, transaction_id, account_id, delta_paise)
  select v_owner, p_reversal_id, account_id, -delta_paise
  from public.entries where owner_id = v_owner and transaction_id = p_transaction_id;
  if jsonb_array_length(v_changes) > 0 then
    perform private.apply_allocation_changes(
      v_owner, v_changes, 'correction', p_reversal_id, v_original.occurred_on
    );
  end if;
  update public.recurring_occurrences
  set status = 'pending', actual_transaction_id = null
  where owner_id = v_owner and actual_transaction_id = p_transaction_id;
  for v_account in
    select distinct a.id, a.kind, a.opening_balance_paise
    from public.accounts a join public.entries e
      on e.owner_id = a.owner_id and e.account_id = a.id
    where e.owner_id = v_owner and e.transaction_id = p_transaction_id
  loop
    select v_account.opening_balance_paise + coalesce(sum(delta_paise), 0)::bigint
      into v_balance from public.entries
    where owner_id = v_owner and account_id = v_account.id;
    if v_account.kind in ('cash', 'bank') then
      select coalesce(sum(cash_amount_paise), 0)::bigint into v_reserved
      from public.goal_allocations where owner_id = v_owner and account_id = v_account.id;
      if v_balance < v_reserved or v_balance < 0 then
        raise exception 'Reversal would leave an account below reserved balance';
      end if;
    elsif v_account.kind in ('card', 'loan') and v_balance < 0 then
      raise exception 'Reversal would make debt negative';
    elsif v_account.kind = 'investment'
      and public.investment_market_value_paise(v_account.id) < 0 then
      raise exception 'Reversal would make investment value negative';
    end if;
  end loop;
  return p_reversal_id;
end;
$$;
revoke all on function public.void_transaction(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.void_transaction(uuid, uuid, jsonb)
  to authenticated;

create view public.effective_transactions with (security_invoker = true) as
select tx.* from public.transactions tx
where tx.kind <> 'reversal'
  and not exists (
    select 1 from public.transactions reversal
    where reversal.owner_id = tx.owner_id
      and reversal.reverses_transaction_id = tx.id
  );
revoke all on public.effective_transactions from public, anon, authenticated;
grant select on public.effective_transactions to authenticated;

create or replace function public.correct_transaction(
  p_original_id uuid, p_reversal_id uuid,
  p_reversal_allocation_changes jsonb, p_replacement jsonb
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_replacement_id uuid;
begin
  if not (select public.is_app_owner()) then raise exception 'Not authorized'; end if;
  if jsonb_typeof(p_replacement) <> 'object' then
    raise exception 'Replacement must be an object';
  end if;
  v_replacement_id := (p_replacement->>'id')::uuid;
  if v_replacement_id is null then raise exception 'Replacement ID is required'; end if;
  perform public.void_transaction(
    p_original_id, p_reversal_id,
    coalesce(p_reversal_allocation_changes, '[]'::jsonb)
  );
  perform public.post_transaction(
    p_id => v_replacement_id,
    p_occurred_on => (p_replacement->>'occurred_on')::date,
    p_kind => p_replacement->>'kind',
    p_amount_paise => (p_replacement->>'amount_paise')::bigint,
    p_source_account_id => (p_replacement->>'source_account_id')::uuid,
    p_destination_account_id => (p_replacement->>'destination_account_id')::uuid,
    p_category_id => (p_replacement->>'category_id')::uuid,
    p_note => p_replacement->>'note',
    p_interest_paise => coalesce((p_replacement->>'interest_paise')::bigint, 0),
    p_allocation_changes => coalesce(p_replacement->'allocation_changes', '[]'::jsonb),
    p_payment_method => p_replacement->>'payment_method'
  );
  return v_replacement_id;
end;
$$;
revoke all on function public.correct_transaction(uuid, uuid, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.correct_transaction(uuid, uuid, jsonb, jsonb)
  to authenticated;

-- Export every table in one SELECT, so PostgreSQL reads all fifteen arrays
-- from the same MVCC statement snapshot. This avoids mixed-time exports when
-- another device posts a transaction during a paginated client-side export.
-- The result can be encrypted by the browser and passed unchanged to
-- restore_backup after decryption in an empty project.
create or replace function public.export_backup_snapshot()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_owner uuid := (select auth.uid());
  v_result jsonb;
begin
  if not (select public.is_app_owner()) then raise exception 'Not authorized'; end if;
  select jsonb_build_object(
    'schema_version', 1,
    'exported_at', now(),
    'accounts', coalesce((select jsonb_agg(to_jsonb(t) order by t.id)
      from public.accounts t where t.owner_id = v_owner), '[]'::jsonb),
    'categories', coalesce((select jsonb_agg(to_jsonb(t) order by t.id)
      from public.categories t where t.owner_id = v_owner), '[]'::jsonb),
    'transactions', coalesce((select jsonb_agg(to_jsonb(t) order by t.id)
      from public.transactions t where t.owner_id = v_owner), '[]'::jsonb),
    'entries', coalesce((select jsonb_agg(to_jsonb(t) order by t.id)
      from public.entries t where t.owner_id = v_owner), '[]'::jsonb),
    'investment_valuations', coalesce((select jsonb_agg(to_jsonb(t) order by t.id)
      from public.investment_valuations t where t.owner_id = v_owner), '[]'::jsonb),
    'goals', coalesce((select jsonb_agg(to_jsonb(t) order by t.id)
      from public.goals t where t.owner_id = v_owner), '[]'::jsonb),
    'goal_allocations', coalesce((select jsonb_agg(to_jsonb(t) order by t.id)
      from public.goal_allocations t where t.owner_id = v_owner), '[]'::jsonb),
    'goal_allocation_changes', coalesce((select jsonb_agg(to_jsonb(t) order by t.id)
      from public.goal_allocation_changes t where t.owner_id = v_owner), '[]'::jsonb),
    'monthly_plans', coalesce((select jsonb_agg(to_jsonb(t) order by t.id)
      from public.monthly_plans t where t.owner_id = v_owner), '[]'::jsonb),
    'plan_items', coalesce((select jsonb_agg(to_jsonb(t) order by t.id)
      from public.plan_items t where t.owner_id = v_owner), '[]'::jsonb),
    'recurring_templates', coalesce((select jsonb_agg(to_jsonb(t) order by t.id)
      from public.recurring_templates t where t.owner_id = v_owner), '[]'::jsonb),
    'recurring_occurrences', coalesce((select jsonb_agg(to_jsonb(t) order by t.id)
      from public.recurring_occurrences t where t.owner_id = v_owner), '[]'::jsonb),
    'alert_states', coalesce((select jsonb_agg(to_jsonb(t) order by t.id)
      from public.alert_states t where t.owner_id = v_owner), '[]'::jsonb),
    'goal_completions', coalesce((select jsonb_agg(to_jsonb(t) order by t.id)
      from public.goal_completions t where t.owner_id = v_owner), '[]'::jsonb),
    'goal_completion_payments', coalesce((select jsonb_agg(to_jsonb(t) order by t.id)
      from public.goal_completion_payments t where t.owner_id = v_owner), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.export_backup_snapshot()
  from public, anon, authenticated;
grant execute on function public.export_backup_snapshot() to authenticated;

-- Import a version-1 encrypted JSON export after the browser decrypts it.
-- The import is allowed only into a project with no application records.
-- Fixed table names and an owner override prevent the payload from choosing
-- SQL objects or claiming another Auth identity. Any failure rolls back all
-- inserted rows; the app should show a preview before calling this RPC.
create or replace function public.restore_backup(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := (select auth.uid());
  v_table text;
  v_rows jsonb;
  v_has_rows boolean;
  v_counts jsonb := '{}'::jsonb;
  v_count integer;
  v_row jsonb;
  v_balance bigint;
  v_reserved bigint;
  v_account record;
begin
  if not (select public.is_app_owner()) then raise exception 'Not authorized'; end if;
  if p_payload is null or p_payload->>'schema_version' <> '1' then
    raise exception 'Unsupported backup schema version';
  end if;
  foreach v_table in array array[
    'accounts', 'categories', 'goals', 'monthly_plans',
    'recurring_templates', 'transactions', 'entries',
    'investment_valuations', 'goal_allocations', 'goal_allocation_changes',
    'plan_items', 'recurring_occurrences', 'alert_states',
    'goal_completions', 'goal_completion_payments'
  ] loop
    execute format('select exists(select 1 from public.%I)', v_table)
      into v_has_rows;
    if v_has_rows then
      raise exception 'Restore requires an empty application database';
    end if;
    v_rows := coalesce(p_payload->v_table, '[]'::jsonb);
    if jsonb_typeof(v_rows) <> 'array' then
      raise exception 'Backup field % must be an array', v_table;
    end if;
  end loop;

  foreach v_table in array array[
    'accounts', 'categories', 'goals', 'monthly_plans',
    'recurring_templates', 'transactions', 'entries',
    'investment_valuations', 'goal_allocations', 'goal_allocation_changes',
    'plan_items', 'recurring_occurrences', 'alert_states',
    'goal_completions', 'goal_completion_payments'
  ] loop
    v_rows := coalesce(p_payload->v_table, '[]'::jsonb);
    v_count := jsonb_array_length(v_rows);
    v_counts := v_counts || jsonb_build_object(v_table, v_count);
    if v_count = 0 then continue; end if;
    if v_table = 'monthly_plans' then
      execute format(
        'insert into public.%I select (jsonb_populate_record(null::public.%I, '
        || 'jsonb_set(jsonb_set(value, ''{owner_id}'', to_jsonb($1)), '
        || '''{source_plan_id}'', ''null''::jsonb))).* '
        || 'from jsonb_array_elements($2) as x(value)',
        v_table, v_table
      ) using v_owner, v_rows;
    elsif v_table = 'transactions' then
      execute format(
        'insert into public.%I select (jsonb_populate_record(null::public.%I, '
        || 'jsonb_set(jsonb_set(value, ''{owner_id}'', to_jsonb($1)), '
        || '''{reverses_transaction_id}'', ''null''::jsonb))).* '
        || 'from jsonb_array_elements($2) as x(value)',
        v_table, v_table
      ) using v_owner, v_rows;
    else
      execute format(
        'insert into public.%I select (jsonb_populate_record(null::public.%I, '
        || 'jsonb_set(value, ''{owner_id}'', to_jsonb($1)))).* '
        || 'from jsonb_array_elements($2) as x(value)',
        v_table, v_table
      ) using v_owner, v_rows;
    end if;
  end loop;

  for v_row in select value from jsonb_array_elements(
    coalesce(p_payload->'monthly_plans', '[]'::jsonb)
  ) loop
    if v_row->>'source_plan_id' is not null then
      update public.monthly_plans
      set source_plan_id = (v_row->>'source_plan_id')::uuid
      where owner_id = v_owner and id = (v_row->>'id')::uuid;
    end if;
  end loop;
  for v_row in select value from jsonb_array_elements(
    coalesce(p_payload->'transactions', '[]'::jsonb)
  ) loop
    if v_row->>'reverses_transaction_id' is not null then
      update public.transactions
      set reverses_transaction_id = (v_row->>'reverses_transaction_id')::uuid
      where owner_id = v_owner and id = (v_row->>'id')::uuid;
    end if;
  end loop;

  if exists (
    select 1 from public.transactions t where t.owner_id = v_owner
      and not exists (select 1 from public.entries e
        where e.owner_id = v_owner and e.transaction_id = t.id)
  ) then
    raise exception 'Backup contains a transaction without account entries';
  end if;
  for v_account in select id, kind, opening_balance_paise
                   from public.accounts where owner_id = v_owner loop
    select v_account.opening_balance_paise + coalesce(sum(delta_paise), 0)::bigint
      into v_balance from public.entries
    where owner_id = v_owner and account_id = v_account.id;
    if v_account.kind in ('cash', 'bank') then
      select coalesce(sum(cash_amount_paise), 0)::bigint into v_reserved
      from public.goal_allocations
      where owner_id = v_owner and account_id = v_account.id;
      if v_balance < 0 or v_reserved > v_balance then
        raise exception 'Backup cash balance or reservations are invalid';
      end if;
    elsif v_account.kind in ('card', 'loan') and v_balance < 0 then
      raise exception 'Backup debt balance is invalid';
    elsif v_account.kind = 'investment' and exists (
      select 1 from public.goal_allocations where owner_id = v_owner
        and account_id = v_account.id
      having sum(investment_share_ppm) > 1000000
    ) then
      raise exception 'Backup investment allocation exceeds 100 percent';
    end if;
  end loop;
  return jsonb_build_object('schema_version', 1, 'restored_counts', v_counts);
end;
$$;
revoke all on function public.restore_backup(jsonb)
  from public, anon, authenticated;
grant execute on function public.restore_backup(jsonb) to authenticated;

-- Realtime events prompt other signed-in devices to refresh their own
-- RLS-filtered queries. The app also refreshes on open/foreground/reconnect.
do $$
declare v_table text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach v_table in array array[
      'transactions', 'goal_allocations', 'plan_items', 'accounts',
      'categories', 'goals', 'monthly_plans', 'recurring_templates',
      'recurring_occurrences', 'alert_states', 'investment_valuations'
    ] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public' and tablename = v_table
      ) then
        execute format('alter publication supabase_realtime add table public.%I', v_table);
      end if;
    end loop;
  end if;
end $$;
