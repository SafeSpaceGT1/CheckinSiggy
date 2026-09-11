-- Prompt 6: clinician surface ------------------------------------------------
-- Clients and session notes belong to the therapist (RLS on therapist_id).
-- Note content is jsonb keyed by the template's section ids, so SOAP, DAP,
-- and BIRP share one table.

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  therapist_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) > 0),
  email text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger clients_set_updated_at
  before update on public.clients
  for each row execute function public.set_updated_at();

alter table public.clients enable row level security;

create policy "Therapists manage their own clients"
  on public.clients
  for all
  using (auth.uid() = therapist_id)
  with check (auth.uid() = therapist_id);

grant all on table public.clients to authenticated;
grant all on table public.clients to service_role;

create index clients_therapist_idx on public.clients (therapist_id, name);

create table public.soap_notes (
  id uuid primary key default gen_random_uuid(),
  therapist_id uuid not null references auth.users (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  format text not null default 'SOAP' check (format in ('SOAP', 'DAP', 'BIRP')),
  session_date date not null default current_date,
  content jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger soap_notes_set_updated_at
  before update on public.soap_notes
  for each row execute function public.set_updated_at();

alter table public.soap_notes enable row level security;

create policy "Therapists manage their own session notes"
  on public.soap_notes
  for all
  using (auth.uid() = therapist_id)
  with check (auth.uid() = therapist_id);

grant all on table public.soap_notes to authenticated;
grant all on table public.soap_notes to service_role;

create index soap_notes_therapist_idx on public.soap_notes (therapist_id, created_at desc);
create index soap_notes_client_idx on public.soap_notes (client_id);
