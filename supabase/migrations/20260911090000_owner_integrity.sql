-- Parent/child ownership must agree at the database boundary. RLS on a child
-- user_id alone allows a caller to attach their row to somebody else's parent.
-- In particular, a forged share could otherwise expose another crisis plan.
-- Validate existing data: stop the migration for review if old rows violate
-- ownership instead of deleting or reassigning sensitive records silently.
alter table public.journal_entries
  add constraint journal_entries_id_user_unique unique (id, user_id);
alter table public.crisis_plans
  add constraint crisis_plans_id_user_unique unique (id, user_id);
alter table public.clients
  add constraint clients_id_therapist_unique unique (id, therapist_id);

alter table public.sentiment_analyses
  add constraint sentiment_analyses_entry_owner_fk
  foreign key (journal_entry_id, user_id)
  references public.journal_entries (id, user_id) on delete cascade;

alter table public.soap_notes
  add constraint soap_notes_client_owner_fk
  foreign key (client_id, therapist_id)
  references public.clients (id, therapist_id) on delete cascade;

do $$
declare child_table text;
begin
  foreach child_table in array array[
    'crisis_warning_signs', 'crisis_coping_strategies', 'crisis_distractions',
    'crisis_support_contacts', 'crisis_professional_contacts',
    'crisis_safety_steps', 'crisis_reasons_for_living', 'crisis_plan_shares'
  ] loop
    execute format(
      'alter table public.%I add constraint %I foreign key (plan_id, user_id) references public.crisis_plans (id, user_id) on delete cascade',
      child_table, child_table || '_plan_owner_fk'
    );
  end loop;
end;
$$;

-- Browser roles need CRUD, not TRUNCATE/TRIGGER/REFERENCES privileges.
-- Explicit table names keep this migration scoped to the SIGGY schema objects.
do $$
declare private_table text;
begin
  foreach private_table in array array[
    'mood_entries', 'journal_entries', 'sentiment_analyses', 'reminders',
    'wellness_goals', 'meditation_sessions', 'exercise_logs', 'crisis_plans',
    'crisis_warning_signs', 'crisis_coping_strategies', 'crisis_distractions',
    'crisis_support_contacts', 'crisis_professional_contacts',
    'crisis_safety_steps', 'crisis_reasons_for_living', 'crisis_plan_shares',
    'clients', 'soap_notes'
  ] loop
    execute format('revoke all on table public.%I from anon, authenticated', private_table);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', private_table);
  end loop;
end;
$$;

-- Fixed search paths avoid resolving objects from caller-controlled schemas.
alter function public.set_updated_at() set search_path = '';
alter function public.get_shared_plan(text) set search_path = '';

-- Toggle from the current database value in a single UPDATE. PostgreSQL's
-- row lock serializes concurrent calls so a stale client cannot overwrite
-- another completion. Invoker permissions and RLS still apply.
create or replace function public.toggle_wellness_goal_today(
  goal_id uuid,
  completion_date date
)
returns public.wellness_goals
language plpgsql
security invoker
set search_path = ''
as $$
declare updated_goal public.wellness_goals;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if completion_date is null
     or completion_date < current_date - 1
     or completion_date > current_date + 1 then
    raise exception 'Completion date must be today in your timezone' using errcode = '22023';
  end if;

  update public.wellness_goals as g
  set completed_dates = case
    when completion_date = any(g.completed_dates)
      then array_remove(g.completed_dates, completion_date)
    else array_append(g.completed_dates, completion_date)
  end
  where g.id = goal_id and g.user_id = auth.uid()
  returning g.* into updated_goal;

  if not found then
    raise exception 'Goal not found' using errcode = 'P0002';
  end if;
  return updated_goal;
end;
$$;
revoke all on function public.toggle_wellness_goal_today(uuid, date) from public;
grant execute on function public.toggle_wellness_goal_today(uuid, date) to authenticated;
