-- A client record alone is not permission to read a SIGGY account. The account
-- holder must accept a private, expiring invitation before sessions can exist.
create table public.therapy_connections (
  id uuid primary key default gen_random_uuid(),
  therapist_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null,
  user_id uuid references auth.users(id) on delete cascade,
  therapist_name text not null check (
    char_length(therapist_name) between 1 and 120
    and therapist_name = btrim(therapist_name, E' \t\n\r\f' || chr(11))
  ),
  created_at timestamptz not null default clock_timestamp(),
  revoked_at timestamptz,
  unique (therapist_id, client_id),
  unique (id, user_id, therapist_id),
  check (user_id is null or user_id <> therapist_id),
  -- Removing an owned clinician record must not erase another account's notes.
  -- NO ACTION checks at statement end, still permitting auth-account cascades.
  foreign key (client_id, therapist_id)
    references public.clients(id, therapist_id) on delete no action
);

-- Tokens are never exposed by table SELECT, even to either participant.
create table public.therapy_connection_invites (
  token uuid primary key default gen_random_uuid(),
  connection_id uuid not null unique references public.therapy_connections(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  check (expires_at > created_at)
);

create table public.therapy_sessions (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  therapist_id uuid not null references auth.users(id) on delete cascade,
  starts_at timestamptz not null,
  duration_minutes integer not null check (duration_minutes between 15 and 180),
  status text not null default 'scheduled' check (status in ('scheduled', 'cancelled')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (id, user_id),
  foreign key (connection_id, user_id, therapist_id)
    references public.therapy_connections(id, user_id, therapist_id) on delete cascade
);

create table public.pre_session_notes (
  session_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (
    char_length(body) between 1 and 2000
    and body = btrim(body, E' \t\n\r\f' || chr(11))
  ),
  status text not null default 'draft' check (status in ('draft', 'submitted')),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (session_id, user_id)
    references public.therapy_sessions(id, user_id) on delete cascade,
  check ((status = 'draft' and submitted_at is null and reviewed_at is null)
    or (status = 'submitted' and submitted_at is not null)),
  check (reviewed_at is null or reviewed_at >= submitted_at)
);

create index therapy_connections_user_idx on public.therapy_connections(user_id);
create index therapy_sessions_user_starts_idx on public.therapy_sessions(user_id, starts_at);
create index therapy_sessions_therapist_starts_idx on public.therapy_sessions(therapist_id, starts_at);
create index therapy_sessions_connection_idx on public.therapy_sessions(connection_id);

alter table public.therapy_connections enable row level security;
alter table public.therapy_connection_invites enable row level security;
alter table public.therapy_sessions enable row level security;
alter table public.pre_session_notes enable row level security;

create policy "Participants read their connections"
  on public.therapy_connections for select to authenticated
  using (user_id = auth.uid() or (therapist_id = auth.uid() and revoked_at is null));

create policy "Participants read their sessions"
  on public.therapy_sessions for select to authenticated
  using (user_id = auth.uid() or (
    therapist_id = auth.uid() and exists (
      select 1 from public.therapy_connections c
      where c.id = connection_id and c.revoked_at is null
    )
  ));

create policy "Clients read their notes and therapists read explicitly shared notes"
  on public.pre_session_notes for select to authenticated
  using (user_id = auth.uid() or (
    status = 'submitted' and exists (
      select 1 from public.therapy_sessions s
      join public.therapy_connections c on c.id = s.connection_id
      where s.id = session_id and s.therapist_id = auth.uid() and c.revoked_at is null
    )
  ));

-- No browser role can insert, change, or delete these rows directly. RPCs below
-- derive identity/status/timestamps at the database boundary, not from UI roles.
revoke all on table public.therapy_connections, public.therapy_connection_invites,
  public.therapy_sessions, public.pre_session_notes from public, anon, authenticated;
grant select on table public.therapy_connections, public.therapy_sessions,
  public.pre_session_notes to authenticated;
grant all on table public.therapy_connections, public.therapy_connection_invites,
  public.therapy_sessions, public.pre_session_notes to service_role;

create function public.create_therapy_invite(p_client_id uuid, p_therapist_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_name text := btrim(p_therapist_name, E' \t\n\r\f' || chr(11));
  v_connection public.therapy_connections;
  v_invite public.therapy_connection_invites;
begin
  if v_user is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_client_id is null or v_name is null or char_length(v_name) not between 1 and 120 then
    raise exception 'A client and therapist name are required' using errcode = '22023';
  end if;
  -- Serializes initial invite creation for the same owned client record.
  perform 1 from public.clients where id = p_client_id and therapist_id = v_user for update;
  if not found then
    raise exception 'Client not found' using errcode = 'P0002';
  end if;
  select * into v_connection from public.therapy_connections
    where client_id = p_client_id and therapist_id = v_user for update;
  if found then
    if v_connection.user_id is not null or v_connection.revoked_at is not null then
      raise exception 'This client connection is already linked or revoked' using errcode = '22023';
    end if;
    update public.therapy_connections set therapist_name = v_name
      where id = v_connection.id returning * into v_connection;
  else
    insert into public.therapy_connections(therapist_id, client_id, therapist_name)
      values(v_user, p_client_id, v_name) returning * into v_connection;
  end if;
  delete from public.therapy_connection_invites where connection_id = v_connection.id;
  insert into public.therapy_connection_invites(connection_id, expires_at)
    values(v_connection.id, clock_timestamp() + interval '7 days') returning * into v_invite;
  return jsonb_build_object('connection', to_jsonb(v_connection),
    'token', v_invite.token, 'expires_at', v_invite.expires_at);
end;
$$;

create function public.preview_therapy_invite(p_token uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_preview jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_token is null then
    raise exception 'An invitation token is required' using errcode = '22023';
  end if;
  select jsonb_build_object('therapist_name', c.therapist_name, 'expires_at', i.expires_at)
    into v_preview from public.therapy_connection_invites i
    join public.therapy_connections c on c.id = i.connection_id
    where i.token = p_token and i.expires_at > clock_timestamp()
      and c.user_id is null and c.revoked_at is null and c.therapist_id <> auth.uid();
  if not found then
    raise exception 'Invitation is unavailable or expired' using errcode = 'P0002';
  end if;
  return v_preview;
end;
$$;

create function public.accept_therapy_invite(p_token uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_connection_id uuid;
  v_connection public.therapy_connections;
  v_invite public.therapy_connection_invites;
begin
  if v_user is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_token is null then
    raise exception 'An invitation token is required' using errcode = '22023';
  end if;
  select connection_id into v_connection_id from public.therapy_connection_invites where token = p_token;
  -- All lifecycle writes acquire the connection lock before touching children.
  select * into v_connection from public.therapy_connections where id = v_connection_id for update;
  if not found or v_connection.revoked_at is not null or v_connection.user_id is not null
    or v_connection.therapist_id = v_user then
    raise exception 'Invitation is unavailable or expired' using errcode = 'P0002';
  end if;
  select * into v_invite from public.therapy_connection_invites
    where token = p_token and connection_id = v_connection.id for update;
  if not found or v_invite.expires_at <= clock_timestamp() then
    raise exception 'Invitation is unavailable or expired' using errcode = 'P0002';
  end if;
  update public.therapy_connections set user_id = v_user
    where id = v_connection.id returning * into v_connection;
  delete from public.therapy_connection_invites where connection_id = v_connection.id;
  return to_jsonb(v_connection);
end;
$$;

create function public.revoke_therapy_connection(p_connection_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_connection public.therapy_connections;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_connection_id is null then
    raise exception 'A connection is required' using errcode = '22023';
  end if;
  select * into v_connection from public.therapy_connections
    where id = p_connection_id and (therapist_id = auth.uid() or user_id = auth.uid()) for update;
  if not found then
    raise exception 'Connection not found' using errcode = 'P0002';
  end if;
  update public.therapy_connections set revoked_at = coalesce(revoked_at, clock_timestamp())
    where id = v_connection.id returning * into v_connection;
  delete from public.therapy_connection_invites where connection_id = v_connection.id;
  update public.therapy_sessions set status = 'cancelled', updated_at = clock_timestamp()
    where connection_id = v_connection.id and starts_at > clock_timestamp() and status = 'scheduled';
  return to_jsonb(v_connection);
end;
$$;

create function public.save_therapy_session(
  p_connection_id uuid, p_starts_at timestamptz, p_duration_minutes integer,
  p_session_id uuid default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_connection public.therapy_connections;
  v_session public.therapy_sessions;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_connection_id is null or p_starts_at is null or p_starts_at <= clock_timestamp()
    or p_starts_at >= clock_timestamp() + interval '1 year'
    or p_duration_minutes is null or p_duration_minutes not between 15 and 180 then
    raise exception 'Choose a future session within one year, lasting 15 to 180 minutes' using errcode = '22023';
  end if;
  select * into v_connection from public.therapy_connections
    where id = p_connection_id and revoked_at is null and user_id is not null
      and (therapist_id = auth.uid() or user_id = auth.uid()) for update;
  if not found then
    raise exception 'Active connection not found' using errcode = 'P0002';
  end if;
  if p_session_id is null then
    insert into public.therapy_sessions(connection_id, user_id, therapist_id, starts_at, duration_minutes)
      values(v_connection.id, v_connection.user_id, v_connection.therapist_id, p_starts_at, p_duration_minutes)
      returning * into v_session;
  else
    update public.therapy_sessions set starts_at = p_starts_at,
      duration_minutes = p_duration_minutes, updated_at = clock_timestamp()
      where id = p_session_id and connection_id = v_connection.id
        and status = 'scheduled' and starts_at > clock_timestamp() returning * into v_session;
    if not found then
      raise exception 'Upcoming scheduled session not found' using errcode = 'P0002';
    end if;
  end if;
  return to_jsonb(v_session);
end;
$$;

create function public.cancel_therapy_session(p_session_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_connection public.therapy_connections;
  v_session public.therapy_sessions;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_session_id is null then
    raise exception 'A session is required' using errcode = '22023';
  end if;
  select c.* into v_connection from public.therapy_connections c
    join public.therapy_sessions s on s.connection_id = c.id
    where s.id = p_session_id and c.revoked_at is null
      and (c.therapist_id = auth.uid() or c.user_id = auth.uid()) for update of c;
  if not found then
    raise exception 'Upcoming session not found' using errcode = 'P0002';
  end if;
  update public.therapy_sessions set status = 'cancelled', updated_at = clock_timestamp()
    where id = p_session_id and connection_id = v_connection.id and starts_at > clock_timestamp()
    returning * into v_session;
  if not found then
    raise exception 'Upcoming session not found' using errcode = 'P0002';
  end if;
  return to_jsonb(v_session);
end;
$$;

create function public.save_pre_session_note(
  p_session_id uuid, p_body text, p_submit boolean, p_expected_updated_at timestamptz default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_body text := btrim(p_body, E' \t\n\r\f' || chr(11));
  v_connection public.therapy_connections;
  v_session public.therapy_sessions;
  v_note public.pre_session_notes;
  v_revision timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_session_id is null or v_body is null or char_length(v_body) not between 1 and 2000
    or p_submit is null then
    raise exception 'A session, note of 1 to 2000 characters, and sharing choice are required' using errcode = '22023';
  end if;
  select c.* into v_connection from public.therapy_connections c
    join public.therapy_sessions s on s.connection_id = c.id
    where s.id = p_session_id and c.revoked_at is null and c.user_id = auth.uid()
      and s.user_id = auth.uid() for update of c;
  if not found then
    raise exception 'Upcoming session not found' using errcode = 'P0002';
  end if;
  select * into v_session from public.therapy_sessions
    where id = p_session_id and user_id = auth.uid() and starts_at > clock_timestamp() and status = 'scheduled'
    for update;
  if not found then
    raise exception 'Upcoming scheduled session not found' using errcode = 'P0002';
  end if;
  select * into v_note from public.pre_session_notes where session_id = v_session.id for update;
  if v_note.updated_at is distinct from p_expected_updated_at then
    raise exception 'This note changed. Reload the saved note before editing.' using errcode = '40001';
  end if;
  -- Timestamps are also opaque edit revisions. Force forward progress even if
  -- two writes land in the same clock tick or the host clock moves backwards.
  v_revision := greatest(clock_timestamp(), v_note.updated_at + interval '1 microsecond');
  insert into public.pre_session_notes(session_id, user_id, body, status, submitted_at, reviewed_at, updated_at)
    values(v_session.id, auth.uid(), v_body, case when p_submit then 'submitted' else 'draft' end,
      case when p_submit then v_revision else null end, null, v_revision)
    on conflict (session_id) do update set body = excluded.body, status = excluded.status,
      submitted_at = excluded.submitted_at, reviewed_at = null, updated_at = excluded.updated_at
    returning * into v_note;
  return to_jsonb(v_note);
end;
$$;

create function public.mark_pre_session_note_reviewed(
  p_session_id uuid, p_expected_updated_at timestamptz default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_connection public.therapy_connections;
  v_note public.pre_session_notes;
  v_revision timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_session_id is null then
    raise exception 'A session is required' using errcode = '22023';
  end if;
  select c.* into v_connection from public.therapy_connections c
    join public.therapy_sessions s on s.connection_id = c.id
    where s.id = p_session_id and c.revoked_at is null
      and c.therapist_id = auth.uid() and s.therapist_id = auth.uid() for update of c;
  if not found then
    raise exception 'Shared note not found' using errcode = 'P0002';
  end if;
  select * into v_note from public.pre_session_notes
    where session_id = p_session_id and status = 'submitted' for update;
  if not found then
    raise exception 'Shared note not found' using errcode = 'P0002';
  end if;
  if p_expected_updated_at is null or v_note.updated_at is distinct from p_expected_updated_at then
    raise exception 'This note changed. Reload the saved note before editing.' using errcode = '40001';
  end if;
  v_revision := greatest(clock_timestamp(), v_note.updated_at + interval '1 microsecond');
  update public.pre_session_notes set reviewed_at = v_revision, updated_at = v_revision
    where session_id = p_session_id returning * into v_note;
  return to_jsonb(v_note);
end;
$$;

-- PostgreSQL grants function EXECUTE to PUBLIC by default. Remove it explicitly,
-- including any inherited Supabase default grants, before exposing each RPC.
revoke all on function public.create_therapy_invite(uuid, text),
  public.preview_therapy_invite(uuid), public.accept_therapy_invite(uuid),
  public.revoke_therapy_connection(uuid),
  public.save_therapy_session(uuid, timestamptz, integer, uuid),
  public.cancel_therapy_session(uuid), public.save_pre_session_note(uuid, text, boolean, timestamptz),
  public.mark_pre_session_note_reviewed(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.create_therapy_invite(uuid, text),
  public.preview_therapy_invite(uuid), public.accept_therapy_invite(uuid),
  public.revoke_therapy_connection(uuid),
  public.save_therapy_session(uuid, timestamptz, integer, uuid),
  public.cancel_therapy_session(uuid), public.save_pre_session_note(uuid, text, boolean, timestamptz),
  public.mark_pre_session_note_reviewed(uuid, timestamptz) to authenticated;
