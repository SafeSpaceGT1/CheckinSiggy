-- Prompt 5: Stanley-Brown crisis plan ---------------------------------------
-- One plan per user, seven ordered child collections, and shareable
-- read-only links via a security-definer lookup that anon can execute.

create table public.crisis_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

create trigger crisis_plans_set_updated_at
  before update on public.crisis_plans
  for each row execute function public.set_updated_at();

alter table public.crisis_plans enable row level security;

create policy "Users manage their own crisis plan"
  on public.crisis_plans for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant all on table public.crisis_plans to authenticated;
grant all on table public.crisis_plans to service_role;

-- Step 1: warning signs
create table public.crisis_warning_signs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  plan_id uuid not null references public.crisis_plans (id) on delete cascade,
  text text not null check (char_length(text) > 0),
  position smallint not null default 0,
  created_at timestamptz not null default now()
);
alter table public.crisis_warning_signs enable row level security;
create policy "Users manage their own warning signs"
  on public.crisis_warning_signs for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
grant all on table public.crisis_warning_signs to authenticated;
grant all on table public.crisis_warning_signs to service_role;
create index crisis_warning_signs_plan_idx on public.crisis_warning_signs (plan_id, position);

-- Step 2: internal coping strategies
create table public.crisis_coping_strategies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  plan_id uuid not null references public.crisis_plans (id) on delete cascade,
  text text not null check (char_length(text) > 0),
  position smallint not null default 0,
  created_at timestamptz not null default now()
);
alter table public.crisis_coping_strategies enable row level security;
create policy "Users manage their own coping strategies"
  on public.crisis_coping_strategies for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
grant all on table public.crisis_coping_strategies to authenticated;
grant all on table public.crisis_coping_strategies to service_role;
create index crisis_coping_strategies_plan_idx on public.crisis_coping_strategies (plan_id, position);

-- Step 3: people and places for distraction
create table public.crisis_distractions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  plan_id uuid not null references public.crisis_plans (id) on delete cascade,
  name text not null check (char_length(name) > 0),
  phone text,
  kind text not null default 'person' check (kind in ('person', 'place')),
  position smallint not null default 0,
  created_at timestamptz not null default now()
);
alter table public.crisis_distractions enable row level security;
create policy "Users manage their own distractions"
  on public.crisis_distractions for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
grant all on table public.crisis_distractions to authenticated;
grant all on table public.crisis_distractions to service_role;
create index crisis_distractions_plan_idx on public.crisis_distractions (plan_id, position);

-- Step 4: people I can ask for help
create table public.crisis_support_contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  plan_id uuid not null references public.crisis_plans (id) on delete cascade,
  name text not null check (char_length(name) > 0),
  phone text,
  relationship text,
  position smallint not null default 0,
  created_at timestamptz not null default now()
);
alter table public.crisis_support_contacts enable row level security;
create policy "Users manage their own support contacts"
  on public.crisis_support_contacts for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
grant all on table public.crisis_support_contacts to authenticated;
grant all on table public.crisis_support_contacts to service_role;
create index crisis_support_contacts_plan_idx on public.crisis_support_contacts (plan_id, position);

-- Step 5: professionals and agencies
create table public.crisis_professional_contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  plan_id uuid not null references public.crisis_plans (id) on delete cascade,
  name text not null check (char_length(name) > 0),
  organization text,
  phone text,
  position smallint not null default 0,
  created_at timestamptz not null default now()
);
alter table public.crisis_professional_contacts enable row level security;
create policy "Users manage their own professional contacts"
  on public.crisis_professional_contacts for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
grant all on table public.crisis_professional_contacts to authenticated;
grant all on table public.crisis_professional_contacts to service_role;
create index crisis_professional_contacts_plan_idx on public.crisis_professional_contacts (plan_id, position);

-- Step 6: making the environment safer
create table public.crisis_safety_steps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  plan_id uuid not null references public.crisis_plans (id) on delete cascade,
  text text not null check (char_length(text) > 0),
  position smallint not null default 0,
  created_at timestamptz not null default now()
);
alter table public.crisis_safety_steps enable row level security;
create policy "Users manage their own safety steps"
  on public.crisis_safety_steps for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
grant all on table public.crisis_safety_steps to authenticated;
grant all on table public.crisis_safety_steps to service_role;
create index crisis_safety_steps_plan_idx on public.crisis_safety_steps (plan_id, position);

-- Reasons for living
create table public.crisis_reasons_for_living (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  plan_id uuid not null references public.crisis_plans (id) on delete cascade,
  text text not null check (char_length(text) > 0),
  position smallint not null default 0,
  created_at timestamptz not null default now()
);
alter table public.crisis_reasons_for_living enable row level security;
create policy "Users manage their own reasons for living"
  on public.crisis_reasons_for_living for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
grant all on table public.crisis_reasons_for_living to authenticated;
grant all on table public.crisis_reasons_for_living to service_role;
create index crisis_reasons_for_living_plan_idx on public.crisis_reasons_for_living (plan_id, position);

-- Share links
create table public.crisis_plan_shares (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  plan_id uuid not null references public.crisis_plans (id) on delete cascade,
  token text not null unique,
  expires_at timestamptz,
  revoked boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.crisis_plan_shares enable row level security;
create policy "Users manage their own plan shares"
  on public.crisis_plan_shares for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
grant all on table public.crisis_plan_shares to authenticated;
grant all on table public.crisis_plan_shares to service_role;
create index crisis_plan_shares_token_idx on public.crisis_plan_shares (token);

-- Public read of a shared plan by token. SECURITY DEFINER so anon can read
-- exactly one plan via a valid, unrevoked, unexpired token — and nothing else.
create or replace function public.get_shared_plan(share_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  share_row public.crisis_plan_shares%rowtype;
  result jsonb;
begin
  select * into share_row
  from public.crisis_plan_shares s
  where s.token = share_token
    and s.revoked = false
    and (s.expires_at is null or s.expires_at > now());

  if not found then
    return null;
  end if;

  select jsonb_build_object(
    'shared_at', now(),
    'warning_signs', coalesce((
      select jsonb_agg(jsonb_build_object('text', w.text) order by w.position, w.created_at)
      from public.crisis_warning_signs w where w.plan_id = share_row.plan_id), '[]'::jsonb),
    'coping_strategies', coalesce((
      select jsonb_agg(jsonb_build_object('text', c.text) order by c.position, c.created_at)
      from public.crisis_coping_strategies c where c.plan_id = share_row.plan_id), '[]'::jsonb),
    'distractions', coalesce((
      select jsonb_agg(jsonb_build_object('name', d.name, 'phone', d.phone, 'kind', d.kind)
        order by d.position, d.created_at)
      from public.crisis_distractions d where d.plan_id = share_row.plan_id), '[]'::jsonb),
    'support_contacts', coalesce((
      select jsonb_agg(jsonb_build_object('name', sc.name, 'phone', sc.phone, 'relationship', sc.relationship)
        order by sc.position, sc.created_at)
      from public.crisis_support_contacts sc where sc.plan_id = share_row.plan_id), '[]'::jsonb),
    'professional_contacts', coalesce((
      select jsonb_agg(jsonb_build_object('name', pc.name, 'organization', pc.organization, 'phone', pc.phone)
        order by pc.position, pc.created_at)
      from public.crisis_professional_contacts pc where pc.plan_id = share_row.plan_id), '[]'::jsonb),
    'safety_steps', coalesce((
      select jsonb_agg(jsonb_build_object('text', ss.text) order by ss.position, ss.created_at)
      from public.crisis_safety_steps ss where ss.plan_id = share_row.plan_id), '[]'::jsonb),
    'reasons_for_living', coalesce((
      select jsonb_agg(jsonb_build_object('text', r.text) order by r.position, r.created_at)
      from public.crisis_reasons_for_living r where r.plan_id = share_row.plan_id), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

revoke all on function public.get_shared_plan(text) from public;
grant execute on function public.get_shared_plan(text) to anon;
grant execute on function public.get_shared_plan(text) to authenticated;
