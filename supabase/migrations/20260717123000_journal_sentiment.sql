-- Prompt 3: journal + sentiment --------------------------------------------
-- Journal entries are editable (updated_at + trigger). Each entry can carry
-- at most one sentiment analysis (AI or local heuristic), upserted by
-- journal_entry_id.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  content text not null check (char_length(content) > 0),
  mood text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger journal_entries_set_updated_at
  before update on public.journal_entries
  for each row execute function public.set_updated_at();

alter table public.journal_entries enable row level security;

create policy "Users manage their own journal entries"
  on public.journal_entries
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant all on table public.journal_entries to authenticated;
grant all on table public.journal_entries to service_role;

create index journal_entries_user_created_idx
  on public.journal_entries (user_id, created_at desc);

create table public.sentiment_analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  journal_entry_id uuid not null references public.journal_entries (id) on delete cascade,
  sentiment text not null check (sentiment in ('positive', 'neutral', 'negative', 'mixed')),
  confidence numeric not null default 0.5 check (confidence >= 0 and confidence <= 1),
  summary text,
  keywords text[] not null default '{}',
  source text not null default 'ai' check (source in ('ai', 'local')),
  created_at timestamptz not null default now(),
  unique (journal_entry_id)
);

alter table public.sentiment_analyses enable row level security;

create policy "Users manage their own sentiment analyses"
  on public.sentiment_analyses
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant all on table public.sentiment_analyses to authenticated;
grant all on table public.sentiment_analyses to service_role;

create index sentiment_analyses_user_created_idx
  on public.sentiment_analyses (user_id, created_at desc);
