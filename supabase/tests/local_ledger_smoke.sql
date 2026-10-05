-- Run only against a disposable database bootstrapped with
-- local_postgres_bootstrap.sql, then the initial migration.
\set ON_ERROR_STOP on

insert into auth.users(id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');
insert into public.app_owner(owner_id)
values ('11111111-1111-4111-8111-111111111111');

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';

insert into public.accounts(id, name, kind, opening_on, opening_balance_paise)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'Savings', 'bank', '2026-10-01', 10000000),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'Mutual Fund', 'investment', '2026-10-01', 1500000),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', 'Credit Card', 'card', '2026-10-01', 500000);
do $$ declare v_failed boolean := false; begin
  begin
    insert into public.accounts(name, kind, opening_on, opening_balance_paise)
    values ('Future Account', 'bank', '2099-01-01', 10000);
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'Future opening date was accepted'; end if;
end $$;
insert into public.categories(id, name, kind) values
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'Salary', 'income'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'Rent', 'expense'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3', 'Goal spending', 'expense');
insert into public.goals(id, name, target_paise) values
  ('cccccccc-cccc-4ccc-8ccc-ccccccccccc1', 'Emergency', 30000000),
  ('cccccccc-cccc-4ccc-8ccc-ccccccccccc2', 'Holiday', 1000000);

select public.quick_save('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 1000000);
do $$ begin
  if (select sum(cash_amount_paise) from public.goal_allocations
      where account_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1') <> 1000000 then
    raise exception 'Quick Save total is wrong';
  end if;
  if (select count(*) from public.goal_allocations
      where account_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
        and cash_amount_paise = 500000) <> 2 then
    raise exception 'Quick Save split is wrong';
  end if;
end $$;

-- Goal reservations make a past-dated transfer unsafe to split using today's
-- source balance. The rejected call must not leave a partial transaction.
do $$ declare v_failed boolean := false; begin
  begin
    perform public.post_transaction(
      p_id => 'dddddddd-dddd-4ddd-8ddd-ddddddddddd9',
      p_occurred_on => (now() at time zone 'Asia/Kolkata')::date - 1,
      p_kind => 'investment_contribution', p_amount_paise => 10000,
      p_source_account_id => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      p_destination_account_id => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
    );
  exception when others then
    if position('Backdated transfer conflicts' in sqlerrm) = 0 then raise; end if;
    v_failed := true;
  end;
  if not v_failed then raise exception 'Backdated allocated transfer was accepted'; end if;
  if exists (select 1 from public.transactions
             where id = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd9') then
    raise exception 'Rejected backdated transfer left a ledger row';
  end if;
end $$;

do $$ declare v_failed boolean := false; begin
  begin
    perform public.post_transaction(
      p_id => 'dddddddd-dddd-4ddd-8ddd-ddddddddddd8',
      p_occurred_on => '2099-01-01', p_kind => 'expense',
      p_amount_paise => 100,
      p_source_account_id => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      p_category_id => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'
    );
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'Future actual transaction was accepted'; end if;
end $$;

select public.post_transaction(
  p_id => 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1',
  p_occurred_on => (now() at time zone 'Asia/Kolkata')::date,
  p_kind => 'investment_contribution',
  p_amount_paise => 1000000,
  p_source_account_id => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  p_destination_account_id => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
);
do $$ begin
  if (select count(*) from public.goal_allocations
      where account_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
        and cash_amount_paise = 450000) <> 2 then
    raise exception 'Proportional cash move is wrong';
  end if;
  if (select count(*) from public.goal_allocations
      where account_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
        and investment_share_ppm = 20000) <> 2 then
    raise exception 'Investment share from transfer is wrong';
  end if;
  if public.account_book_balance_paise('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1') <> 9000000
     or public.investment_market_value_paise('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2') <> 2500000 then
    raise exception 'Transfer balances are wrong';
  end if;
end $$;

-- An offline retry with the same UUID cannot create a second entry.
select public.post_transaction(
  p_id => 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1',
  p_occurred_on => (now() at time zone 'Asia/Kolkata')::date,
  p_kind => 'investment_contribution',
  p_amount_paise => 1000000,
  p_source_account_id => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  p_destination_account_id => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
);
do $$ begin
  if (select count(*) from public.entries
      where transaction_id = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1') <> 2 then
    raise exception 'Idempotency failed';
  end if;
end $$;

-- Spending more than unreserved cash must fail without leaving a ledger row.
do $$ declare v_failed boolean := false; begin
  begin
    perform public.post_transaction(
      p_id => 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2',
      p_occurred_on => (now() at time zone 'Asia/Kolkata')::date,
      p_kind => 'expense',
      p_amount_paise => 8200000,
      p_source_account_id => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      p_category_id => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'
    );
  exception when others then
    v_failed := true;
  end;
  if not v_failed then raise exception 'Overspend unexpectedly succeeded'; end if;
  if exists (select 1 from public.transactions
             where id = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2') then
    raise exception 'Failed transaction left a row';
  end if;
end $$;

select public.post_transaction(
  p_id => 'dddddddd-dddd-4ddd-8ddd-ddddddddddd3',
  p_occurred_on => (now() at time zone 'Asia/Kolkata')::date,
  p_kind => 'expense',
  p_amount_paise => 20000,
  p_source_account_id => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
  p_category_id => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'
);
select public.post_transaction(
  p_id => 'dddddddd-dddd-4ddd-8ddd-ddddddddddd4',
  p_occurred_on => (now() at time zone 'Asia/Kolkata')::date,
  p_kind => 'card_payment',
  p_amount_paise => 30000,
  p_source_account_id => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  p_destination_account_id => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'
);
do $$ begin
  if public.account_book_balance_paise('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3') <> 490000 then
    raise exception 'Credit card debt or repayment is wrong';
  end if;
end $$;

select public.complete_goal(
  'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
  jsonb_build_array(jsonb_build_object(
    'id', 'dddddddd-dddd-4ddd-8ddd-ddddddddddd5',
    'account_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'amount_paise', 500000,
    'category_id', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3',
    'payment_method', 'UPI'
  )),
  jsonb_build_array(
    jsonb_build_object('goal_id', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
      'account_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'cash_amount_paise', 0),
    jsonb_build_object('goal_id', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
      'account_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'investment_share_ppm', 0)
  ),
  'Used emergency savings'
);
do $$ begin
  if (select status from public.goals
      where id = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1') <> 'completed' then
    raise exception 'Goal completion status is wrong';
  end if;
  if (select count(*) from public.goal_completion_payments) <> 1 then
    raise exception 'Goal completion payment is missing';
  end if;
end $$;

select public.create_monthly_plan('2026-10-01', false);
insert into public.plan_items(plan_id, name, kind, planned_paise, category_id)
select id, 'Rent', 'fixed_expense', 100000, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'
from public.monthly_plans where month_start = '2026-10-01';
select public.create_monthly_plan('2026-11-01', true);
do $$ begin
  if (select count(*) from public.plan_items pi
      join public.monthly_plans mp on mp.id = pi.plan_id
      where mp.month_start = '2026-11-01') <> 1 then
    raise exception 'Copied plan lines missing';
  end if;
end $$;

insert into public.recurring_templates
  (id, name, kind, amount_paise, due_day, starts_on, source_account_id, category_id)
values
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', 'Rent', 'expense', 100000,
   31, '2026-10-01', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
   'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2');
select public.ensure_recurring_occurrences('2026-11-01');
do $$ begin
  if (select due_on from public.recurring_occurrences
      where month_start = '2026-11-01') <> '2026-11-30' then
    raise exception 'Recurring due-day clamp is wrong';
  end if;
end $$;

set request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $$ begin
  if public.is_app_owner() then raise exception 'Unexpected second owner'; end if;
  if (select count(*) from public.accounts) <> 0 then
    raise exception 'Second user can read owner accounts';
  end if;
  begin
    insert into public.accounts(name, kind) values ('Intruder', 'bank');
    raise exception 'Second user could insert an account';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
select 'ledger smoke test passed' as result;
