-- Run after local_ledger_smoke.sql in the same disposable database.
\set ON_ERROR_STOP on
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';

select public.record_recurring_payment(
  (select id from public.recurring_occurrences where month_start = '2026-11-01'),
  'dddddddd-dddd-4ddd-8ddd-ddddddddddd6',
  (now() at time zone 'Asia/Kolkata')::date, 100000
);
select public.record_recurring_payment(
  (select id from public.recurring_occurrences where month_start = '2026-11-01'),
  'dddddddd-dddd-4ddd-8ddd-ddddddddddd6',
  (now() at time zone 'Asia/Kolkata')::date, 100000
);
do $$ begin
  if (select count(*) from public.entries
      where transaction_id = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd6') <> 1 then
    raise exception 'Recurring payment was duplicated';
  end if;
end $$;
select public.void_transaction(
  'dddddddd-dddd-4ddd-8ddd-ddddddddddd6',
  'ffffffff-ffff-4fff-8fff-fffffffffff1'
);
do $$ begin
  if (select status from public.recurring_occurrences
      where month_start = '2026-11-01') <> 'pending' then
    raise exception 'Voiding recurring payment did not restore pending status';
  end if;
  if exists (select 1 from public.effective_transactions
             where id = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd6') then
    raise exception 'Voided transaction remains in effective reports';
  end if;
end $$;

select public.correct_transaction(
  'dddddddd-dddd-4ddd-8ddd-ddddddddddd3',
  'ffffffff-ffff-4fff-8fff-fffffffffff2',
  '[]'::jsonb,
  jsonb_build_object(
    'id', 'ffffffff-ffff-4fff-8fff-fffffffffff3',
    'occurred_on', (now() at time zone 'Asia/Kolkata')::date,
    'kind', 'expense',
    'amount_paise', 10000,
    'source_account_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
    'category_id', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'
  )
);
do $$ begin
  if public.account_book_balance_paise('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3') <> 480000 then
    raise exception 'Correction did not recompute card debt';
  end if;
  if (select count(*) from public.effective_transactions
      where id in ('dddddddd-dddd-4ddd-8ddd-ddddddddddd3',
                   'ffffffff-ffff-4fff-8fff-fffffffffff3')) <> 1 then
    raise exception 'Correction appears twice in reports';
  end if;
end $$;

-- A valuation entered later but dated before a contribution must still add
-- that contribution to today's market estimate.
insert into public.investment_valuations(account_id, as_of_date, market_value_paise)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', '2026-10-01', 1500000);
do $$ begin
  if public.investment_market_value_paise('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2') <> 2500000 then
    raise exception 'Backdated valuation swallowed a later contribution';
  end if;
end $$;
insert into public.investment_valuations(account_id, as_of_date, market_value_paise)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
  (now() at time zone 'Asia/Kolkata')::date, 2700000);
do $$ begin
  if public.investment_market_value_paise('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2') <> 2700000 then
    raise exception 'Manual market valuation was not used';
  end if;
end $$;
do $$ declare v_failed boolean := false; begin
  begin
    insert into public.investment_valuations(account_id, as_of_date, market_value_paise)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', '2099-01-01', 1);
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'Future valuation was accepted'; end if;
end $$;

-- Only Holiday remains active. Quick Save may fund it beyond its target.
select public.quick_save('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 1500000);
do $$ begin
  if (select cash_amount_paise from public.goal_allocations
      where goal_id = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2'
        and account_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1') <> 1950000 then
    raise exception 'Quick Save did not overfund the active goal';
  end if;
end $$;

-- Transfer and explicit reversal must preserve source reservations and
-- pre-existing fund shares, including the manual valuation.
do $$
declare
  v_cash_before bigint;
  v_share_before integer;
  v_market_before bigint;
begin
  select cash_amount_paise into v_cash_before
  from public.goal_allocations
  where goal_id = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2'
    and account_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  select investment_share_ppm into v_share_before
  from public.goal_allocations
  where goal_id = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2'
    and account_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
  v_market_before := public.investment_market_value_paise(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2');
  perform public.post_transaction(
    p_id => 'dddddddd-dddd-4ddd-8ddd-ddddddddddd7',
    p_occurred_on => (now() at time zone 'Asia/Kolkata')::date,
    p_kind => 'investment_contribution',
    p_amount_paise => 1000000,
    p_source_account_id => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    p_destination_account_id => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
  );
  if public.investment_market_value_paise('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2')
    <> v_market_before + 1000000 then
    raise exception 'Contribution after valuation did not add to market value';
  end if;
  perform public.void_transaction(
    'dddddddd-dddd-4ddd-8ddd-ddddddddddd7',
    'ffffffff-ffff-4fff-8fff-fffffffffff4',
    jsonb_build_array(
      jsonb_build_object('goal_id', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2',
        'account_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
        'cash_amount_paise', v_cash_before),
      jsonb_build_object('goal_id', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2',
        'account_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
        'investment_share_ppm', v_share_before)
    )
  );
  if public.investment_market_value_paise('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2')
    <> v_market_before then
    raise exception 'Reversal did not restore market value';
  end if;
end $$;

set request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $$ declare v_failed boolean := false; begin
  begin
    perform public.quick_save('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 100);
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'Second user invoked owner-only RPC'; end if;
  v_failed := false;
  begin
    perform public.export_backup_snapshot();
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'Second user exported owner backup'; end if;
end $$;

reset role;
create temporary table backup_payload(payload jsonb);
grant select, insert on backup_payload to authenticated;
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
insert into backup_payload select public.export_backup_snapshot();
do $$ begin
  if (select payload->>'schema_version' from backup_payload) <> '1'
     or (select payload->>'exported_at' from backup_payload) is null
     or (select jsonb_array_length(payload->'transactions') from backup_payload) <> 10
     or (select jsonb_array_length(payload->'entries') from backup_payload) <> 14
     or (select payload ? 'app_owner' from backup_payload) then
    raise exception 'Export snapshot shape or row counts are wrong';
  end if;
end $$;
reset role;

truncate public.accounts, public.categories, public.transactions, public.entries,
  public.investment_valuations, public.goals, public.goal_allocations,
  public.goal_allocation_changes, public.monthly_plans, public.plan_items,
  public.recurring_templates, public.recurring_occurrences, public.alert_states,
  public.goal_completions, public.goal_completion_payments;
insert into auth.users(id) values ('33333333-3333-4333-8333-333333333333');
update public.app_owner set owner_id = '33333333-3333-4333-8333-333333333333';

set role authenticated;
set request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
select public.restore_backup((select payload from backup_payload));
do $$ begin
  if (select count(*) from public.accounts) <> 3
    or (select count(*) from public.goal_completions) <> 1
    or (select count(*) from public.monthly_plans) <> 2 then
    raise exception 'Restore lost records';
  end if;
  if exists (select 1 from public.accounts
             where owner_id <> '33333333-3333-4333-8333-333333333333') then
    raise exception 'Restore did not remap owner';
  end if;
  if public.investment_market_value_paise('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2') <> 2700000 then
    raise exception 'Restore changed investment value';
  end if;
end $$;

-- A past-dated contribution is also unsafe when the destination has a
-- valuation, even if neither account has any goal reservations.
insert into public.accounts(id, name, kind, opening_on, opening_balance_paise)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', 'Unallocated Cash', 'bank',
   (now() at time zone 'Asia/Kolkata')::date - 2, 100000),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5', 'Unallocated Fund', 'investment',
   (now() at time zone 'Asia/Kolkata')::date - 2, 0);
insert into public.investment_valuations(account_id, as_of_date, market_value_paise)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5',
  (now() at time zone 'Asia/Kolkata')::date - 1, 0);
do $$ declare v_failed boolean := false; v_id uuid := gen_random_uuid(); begin
  begin
    perform public.post_transaction(
      p_id => v_id,
      p_occurred_on => (now() at time zone 'Asia/Kolkata')::date - 1,
      p_kind => 'investment_contribution', p_amount_paise => 1000,
      p_source_account_id => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',
      p_destination_account_id => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5'
    );
  exception when others then
    if position('Backdated transfer conflicts' in sqlerrm) = 0 then raise; end if;
    v_failed := true;
  end;
  if not v_failed then raise exception 'Backdated valued transfer was accepted'; end if;
  if exists (select 1 from public.transactions where id = v_id) then
    raise exception 'Rejected valued transfer left a ledger row';
  end if;
end $$;

reset role;
select 'extended smoke test passed' as result;
