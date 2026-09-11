-- Prompt 4: reminders, wellness goals, meditation, exercise -----------------
-- Four tables. Notifications built on `reminders` never include user content;
-- the client only ever sends the fixed copy "Your SIGGY check-in is ready."

create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) > 0),
  kind text not null default 'mood_check'
    check (kind in ('mood_check', 'journal', 'meditation', 'custom')),
  time_of_day time not null,
  days_of_week smallint[] not null default '{0,1,2,3,4,5,6}',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger reminders_set_updated_at
  before update on public.reminders
  for each row execute function public.set_updated_at();

alter table public.reminders enable row level security;

create policy "Users manage their own reminders"
  on public.reminders
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant all on table public.reminders to authenticated;
grant all on table public.reminders to service_role;

create index reminders_user_idx on public.reminders (user_id, time_of_day);

create table public.wellness_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) > 0),
  target_per_week smallint not null default 3 check (target_per_week between 1 and 14),
  completed_dates date[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger wellness_goals_set_updated_at
  before update on public.wellness_goals
  for each row execute function public.set_updated_at();

alter table public.wellness_goals enable row level security;

create policy "Users manage their own wellness goals"
  on public.wellness_goals
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant all on table public.wellness_goals to authenticated;
grant all on table public.wellness_goals to service_role;

create index wellness_goals_user_idx on public.wellness_goals (user_id, created_at desc);

create table public.meditation_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  meditation_id text not null,
  title text not null,
  duration_minutes smallint not null check (duration_minutes > 0),
  completed_seconds integer not null check (completed_seconds >= 0),
  created_at timestamptz not null default now()
);

alter table public.meditation_sessions enable row level security;

create policy "Users manage their own meditation sessions"
  on public.meditation_sessions
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant all on table public.meditation_sessions to authenticated;
grant all on table public.meditation_sessions to service_role;

create index meditation_sessions_user_idx
  on public.meditation_sessions (user_id, created_at desc);

create table public.exercise_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  activity text not null check (char_length(activity) > 0),
  minutes smallint not null check (minutes > 0),
  intensity text not null default 'moderate'
    check (intensity in ('light', 'moderate', 'vigorous')),
  notes text,
  created_at timestamptz not null default now()
);

alter table public.exercise_logs enable row level security;

create policy "Users manage their own exercise logs"
  on public.exercise_logs
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant all on table public.exercise_logs to authenticated;
grant all on table public.exercise_logs to service_role;

create index exercise_logs_user_idx on public.exercise_logs (user_id, created_at desc);
