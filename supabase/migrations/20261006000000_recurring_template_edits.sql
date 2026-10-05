-- An edit updates pending reminders for this and future months. Overdue
-- reminders from earlier months, completed items, and skipped items retain
-- their original schedule and expected amount.
create or replace function private.refresh_pending_recurring_occurrences()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.amount_paise is distinct from old.amount_paise
     or new.due_day is distinct from old.due_day then
    update public.recurring_occurrences occurrence
    set expected_amount_paise = new.amount_paise,
        due_on = least(
          occurrence.month_start + (new.due_day - 1),
          (occurrence.month_start + interval '1 month - 1 day')::date
        )
    where occurrence.owner_id = new.owner_id
      and occurrence.template_id = new.id
      and occurrence.status = 'pending'
      and occurrence.month_start >= date_trunc('month', now() at time zone 'Asia/Kolkata')::date;
  end if;
  return new;
end;
$$;

create trigger refresh_pending_recurring_occurrences
after update of amount_paise, due_day on public.recurring_templates
for each row execute function private.refresh_pending_recurring_occurrences();
