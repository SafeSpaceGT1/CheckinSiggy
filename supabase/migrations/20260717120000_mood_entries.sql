-- Prompt 2: mood check-ins ------------------------------------------------
-- Quick check-ins store value (1-5) + emoji. Detailed check-ins add a 1-10
-- rating, tag chips, optional notes, and a "bring to next session" flag.

create table public.mood_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  value smallint not null check (value between 1 and 5),
  emoji text not null,
  notes text,
  rating_10 smallint check (rating_10 between 1 and 10),
  tags text[] not null default '{}',
  add_to_next_session boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.mood_entries enable row level security;

create policy "Users manage their own mood entries"
  on public.mood_entries
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant all on table public.mood_entries to authenticated;
grant all on table public.mood_entries to service_role;

create index mood_entries_user_created_idx
  on public.mood_entries (user_id, created_at desc);
