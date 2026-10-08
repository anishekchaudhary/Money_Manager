-- The account_id on an investment plan is its destination holding. A separate
-- funding account lets the dashboard locate money reserved for unpaid plans.
alter table public.plan_items
  add column funding_account_id uuid,
  add constraint plan_items_funding_account_owner_fk
    foreign key (owner_id, funding_account_id)
    references public.accounts(owner_id, id);

create or replace function private.validate_plan_funding_account()
returns trigger language plpgsql set search_path = '' as $$
declare v_kind text;
begin
  if new.funding_account_id is null then return new; end if;
  if new.kind = 'income' then
    raise exception 'Income plans do not reserve a funding account';
  end if;
  select kind into v_kind from public.accounts
  where owner_id = new.owner_id and id = new.funding_account_id;
  if v_kind is distinct from 'cash' and v_kind is distinct from 'bank' then
    raise exception 'Plan funding account must be cash or bank';
  end if;
  return new;
end;
$$;

create trigger validate_plan_funding_account
before insert or update of funding_account_id, kind on public.plan_items
for each row execute function private.validate_plan_funding_account();

-- Keep source-account assignments when the owner copies a monthly plan.
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
      category_id, goal_id, account_id, funding_account_id, recurring_template_id
    )
    select v_owner, v_new, name, kind, planned_paise, due_day,
      category_id, goal_id, account_id, funding_account_id, recurring_template_id
    from public.plan_items where owner_id = v_owner and plan_id = v_source;
  end if;
  return v_new;
end;
$$;
