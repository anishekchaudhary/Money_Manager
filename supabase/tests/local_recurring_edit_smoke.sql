-- Run only in a disposable database after local_postgres_bootstrap.sql and
-- both application migrations. Never run this against a real Supabase project.
\set ON_ERROR_STOP on

insert into auth.users(id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');
insert into public.app_owner(owner_id)
values ('11111111-1111-4111-8111-111111111111');

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';

insert into public.accounts(id, name, kind, opening_on, opening_balance_paise)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'Savings', 'bank',
        (now() at time zone 'Asia/Kolkata')::date, 1000000);
insert into public.categories(id, name, kind)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'Rent', 'expense');
insert into public.recurring_templates
  (id, name, kind, amount_paise, due_day, starts_on, source_account_id, category_id)
values
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', 'Rent', 'expense', 100000, 5,
   (now() at time zone 'Asia/Kolkata')::date,
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
   'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1');

select public.ensure_recurring_occurrences(
  date_trunc('month', now() at time zone 'Asia/Kolkata')::date);
select public.ensure_recurring_occurrences(
  (date_trunc('month', now() at time zone 'Asia/Kolkata') + interval '1 month')::date);

select public.set_recurring_occurrence_status(
  (select id from public.recurring_occurrences
   where month_start = (date_trunc('month', now() at time zone 'Asia/Kolkata') + interval '1 month')::date),
  'skipped');

update public.recurring_templates
set amount_paise = 120000, due_day = 31
where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1';

do $$
declare v_month date := date_trunc('month', now() at time zone 'Asia/Kolkata')::date;
begin
  if not exists (
    select 1 from public.recurring_occurrences
    where template_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1'
      and month_start = v_month and status = 'pending'
      and expected_amount_paise = 120000
      and due_on = (v_month + interval '1 month - 1 day')::date
  ) then raise exception 'Current pending reminder did not follow the edit'; end if;
  if not exists (
    select 1 from public.recurring_occurrences
    where template_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1'
      and month_start = (v_month + interval '1 month')::date
      and status = 'skipped' and expected_amount_paise = 100000
  ) then raise exception 'Skipped reminder was changed'; end if;
end $$;

set request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
update public.recurring_templates
set amount_paise = 130000
where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1';
set request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
do $$ begin
  if (select amount_paise from public.recurring_templates
      where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1') <> 120000 then
    raise exception 'Non-owner changed a recurring template';
  end if;
end $$;
