import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';

// Exercise the production SQL, auth claims and PostgreSQL permissions together.
// A display role in local storage is deliberately absent from this test setup.
const db = new PGlite();
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const therapist = id(1), client = id(2), stranger = id(3), otherTherapist = id(4);
const future = (days = 2) => new Date(Date.now() + days * 86400000).toISOString();
const tables = ['therapy_connections', 'therapy_connection_invites', 'therapy_sessions', 'pre_session_notes'];
const rpc = async (name, args) => (await db.query(
  `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) as result`, args,
)).rows[0].result;
const asUser = async (user, work, role = 'authenticated') => {
  await db.exec(`set role ${role}`);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user ?? '']);
  try { return await work(); } finally {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  }
};
const rejectsCode = (work, code) => assert.rejects(work, error => error.code === code);
const visible = async (table, field, value) => (await db.query(
  `select * from public.${table} where ${field}=$1`, [value],
)).rows;
let fixtureNumber = 100;
const pending = async (owner = therapist) => {
  const clientId = id(fixtureNumber++);
  const invite = await asUser(owner, async () => {
    await db.query('insert into public.clients(id,therapist_id,name) values($1,$2,$3)', [clientId, owner, 'Client record']);
    return rpc('create_therapy_invite', [clientId, '  Dr. Taylor  ']);
  });
  return { ...invite, clientId };
};
const connected = async (owner = therapist, account = client) => {
  const invite = await pending(owner);
  const connection = await asUser(account, () => rpc('accept_therapy_invite', [invite.token]));
  return { ...invite, connection };
};
const scheduled = async (owner = therapist, account = client) => {
  const result = await connected(owner, account);
  const session = await asUser(owner, () => rpc('save_therapy_session', [result.connection.id, future(), 50]));
  return { ...result, session };
};

before(async () => {
  await db.exec(await readFile(new URL('../supabase/tests/database/bootstrap.sql', import.meta.url), 'utf8'));
  const directory = new URL('../supabase/migrations/', import.meta.url);
  for (const migration of (await readdir(directory)).filter(name => name.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(migration, directory), 'utf8'));
  }
  await db.query('insert into auth.users(id) values ($1),($2),($3),($4)', [therapist, client, stranger, otherTherapist]);
});
after(async () => { await db.close(); });

test('RPCs alone authorize writes; anonymous callers and missing claims cannot invoke them', async () => {
  const calls = [
    ['create_therapy_invite', [id(999), 'Dr. Taylor']],
    ['preview_therapy_invite', [id(999)]],
    ['accept_therapy_invite', [id(999)]],
    ['revoke_therapy_connection', [id(999)]],
    ['save_therapy_session', [id(999), future(), 50, null]],
    ['cancel_therapy_session', [id(999)]],
    ['save_pre_session_note', [id(999), 'My note', true]],
    ['mark_pre_session_note_reviewed', [id(999)]],
  ];
  for (const role of ['anon', 'authenticated']) {
    await asUser(null, async () => {
      for (const [name, args] of calls) await rejectsCode(rpc(name, args), '42501');
    }, role);
  }
  for (const user of [therapist, client, stranger]) {
    await asUser(user, async () => {
      for (const table of tables) {
        await rejectsCode(db.query(`insert into public.${table} default values`), '42501');
        await rejectsCode(db.query(`update public.${table} set ${table === 'pre_session_notes' ? 'user_id' : table === 'therapy_connection_invites' ? 'token' : 'id'}=$1`, [user]), '42501');
        await rejectsCode(db.query(`delete from public.${table}`), '42501');
      }
      await rejectsCode(db.query('select * from public.therapy_connection_invites'), '42501');
    });
  }
  const functions = (await db.query(`
    select p.proname, p.prosecdef, p.proconfig,
      has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any($1::text[])
  `, [calls.map(([name]) => name)])).rows;
  assert.equal(functions.length, calls.length);
  for (const fn of functions) {
    assert.equal(fn.prosecdef, true, fn.proname);
    assert.deepEqual(fn.proconfig, ['search_path=""'], fn.proname);
    assert.equal(fn.anon_execute, false, fn.proname);
    assert.equal(fn.authenticated_execute, true, fn.proname);
  }
});

test('invites require an owned client, preview only safe fields, and bind the explicitly accepting account', async () => {
  const invite = await pending();
  assert.equal(invite.connection.user_id, null);
  assert.equal(invite.connection.therapist_name, 'Dr. Taylor');
  assert.match(invite.token, /^[0-9a-f-]{36}$/i);
  assert.ok(Date.parse(invite.expires_at) > Date.now() + 6 * 86400000);
  await asUser(otherTherapist, async () => {
    await rejectsCode(rpc('create_therapy_invite', [invite.clientId, 'Other']), 'P0002');
    assert.deepEqual(await visible('therapy_connections', 'id', invite.connection.id), []);
  });
  await asUser(therapist, async () => {
    await rejectsCode(rpc('accept_therapy_invite', [invite.token]), 'P0002');
    await rejectsCode(rpc('save_therapy_session', [invite.connection.id, future(), 50]), 'P0002');
  });
  await asUser(client, async () => {
    const preview = await rpc('preview_therapy_invite', [invite.token]);
    assert.deepEqual(Object.keys(preview).sort(), ['expires_at', 'therapist_name']);
    assert.equal(preview.therapist_name, 'Dr. Taylor');
    assert.deepEqual(await visible('therapy_connections', 'id', invite.connection.id), []);
    const accepted = await rpc('accept_therapy_invite', [invite.token]);
    assert.equal(accepted.user_id, client);
    assert.equal(accepted.therapist_id, therapist);
    assert.equal((await visible('therapy_connections', 'id', invite.connection.id)).length, 1);
  });
  assert.equal((await db.query('select * from public.therapy_connection_invites where token=$1', [invite.token])).rows.length, 0);
  for (const user of [client, stranger]) await asUser(user, async () => {
    await rejectsCode(rpc('accept_therapy_invite', [invite.token]), 'P0002');
    await rejectsCode(rpc('preview_therapy_invite', [invite.token]), 'P0002');
  });
  await asUser(therapist, () => rejectsCode(rpc('create_therapy_invite', [invite.clientId, 'Replacement']), '22023'));
});

test('reissuing rotates the secret, expired invitations cannot link, and revoking removes invitations', async () => {
  const first = await pending();
  const second = await asUser(therapist, () => rpc('create_therapy_invite', [first.clientId, 'Dr. Updated']));
  assert.equal(second.connection.id, first.connection.id);
  assert.notEqual(second.token, first.token);
  await asUser(client, async () => {
    await rejectsCode(rpc('accept_therapy_invite', [first.token]), 'P0002');
    assert.equal((await rpc('preview_therapy_invite', [second.token])).therapist_name, 'Dr. Updated');
  });
  await db.query("update public.therapy_connection_invites set created_at=now()-interval '2 days', expires_at=now()-interval '1 day' where token=$1", [second.token]);
  await asUser(client, async () => {
    await rejectsCode(rpc('preview_therapy_invite', [second.token]), 'P0002');
    await rejectsCode(rpc('accept_therapy_invite', [second.token]), 'P0002');
  });
  const third = await asUser(therapist, () => rpc('create_therapy_invite', [first.clientId, 'Dr. Updated']));
  const revoked = await asUser(therapist, () => rpc('revoke_therapy_connection', [third.connection.id]));
  assert.ok(revoked.revoked_at);
  await asUser(client, () => rejectsCode(rpc('accept_therapy_invite', [third.token]), 'P0002'));
  await asUser(therapist, () => rejectsCode(rpc('create_therapy_invite', [first.clientId, 'Again']), '22023'));
});

test('client saves a private draft, shares it, therapist reviews it, and edits clear the review', async () => {
  const { session } = await scheduled();
  const draft = await asUser(client, () => rpc('save_pre_session_note', [session.id, '  I have felt overwhelmed.\n ', false]));
  assert.equal(draft.body, 'I have felt overwhelmed.');
  assert.equal(draft.user_id, client);
  assert.equal(draft.status, 'draft');
  assert.equal(draft.submitted_at, null);
  assert.equal(draft.reviewed_at, null);
  await asUser(therapist, async () => {
    assert.deepEqual(await visible('pre_session_notes', 'session_id', session.id), []);
    await rejectsCode(rpc('mark_pre_session_note_reviewed', [session.id]), 'P0002');
    await rejectsCode(rpc('save_pre_session_note', [session.id, 'Therapist cannot author this', true]), 'P0002');
  });
  const submitted = await asUser(client, () => rpc('save_pre_session_note', [session.id, draft.body, true, draft.updated_at]));
  assert.equal(submitted.status, 'submitted');
  assert.ok(submitted.submitted_at);
  const reviewed = await asUser(therapist, async () => {
    assert.equal((await visible('pre_session_notes', 'session_id', session.id))[0].body, draft.body);
    return rpc('mark_pre_session_note_reviewed', [session.id, submitted.updated_at]);
  });
  assert.ok(Date.parse(reviewed.reviewed_at) >= Date.parse(submitted.submitted_at));
  await asUser(client, async () => {
    assert.ok((await visible('pre_session_notes', 'session_id', session.id))[0].reviewed_at);
    await rejectsCode(rpc('mark_pre_session_note_reviewed', [session.id]), 'P0002');
    const edited = await rpc('save_pre_session_note', [session.id, 'I want to talk about sleep.', true, reviewed.updated_at]);
    assert.equal(edited.reviewed_at, null);
    assert.ok(Date.parse(edited.submitted_at) >= Date.parse(submitted.submitted_at));
    const withdrawn = await rpc('save_pre_session_note', [session.id, 'A new private draft.', false, edited.updated_at]);
    assert.equal(withdrawn.status, 'draft');
    assert.equal(withdrawn.submitted_at, null);
    assert.equal(withdrawn.reviewed_at, null);
  });
  await asUser(therapist, async () => assert.deepEqual(await visible('pre_session_notes', 'session_id', session.id), []));
});

test('a third account cannot discover or mutate any linked data, even when ids are known', async () => {
  const { connection, session } = await scheduled();
  await asUser(client, () => rpc('save_pre_session_note', [session.id, 'For my therapist.', true]));
  await asUser(stranger, async () => {
    assert.deepEqual(await visible('therapy_connections', 'id', connection.id), []);
    assert.deepEqual(await visible('therapy_sessions', 'id', session.id), []);
    assert.deepEqual(await visible('pre_session_notes', 'session_id', session.id), []);
    for (const [name, args] of [
      ['save_therapy_session', [connection.id, future(), 45]],
      ['save_therapy_session', [connection.id, future(), 45, session.id]],
      ['cancel_therapy_session', [session.id]],
      ['save_pre_session_note', [session.id, 'Forged', true]],
      ['mark_pre_session_note_reviewed', [session.id]],
      ['revoke_therapy_connection', [connection.id]],
    ]) await rejectsCode(rpc(name, args), 'P0002');
  });
});

test('composite foreign keys reject forged client ownership, session participants, and note ownership', async () => {
  const { connection, session, clientId } = await scheduled();
  await rejectsCode(db.query('insert into public.therapy_connections(therapist_id,client_id,therapist_name) values($1,$2,$3)', [otherTherapist, clientId, 'Forged']), '23503');
  await rejectsCode(db.query('insert into public.therapy_sessions(connection_id,user_id,therapist_id,starts_at,duration_minutes) values($1,$2,$3,$4,45)', [connection.id, stranger, therapist, future()]), '23503');
  await rejectsCode(db.query('insert into public.therapy_sessions(connection_id,user_id,therapist_id,starts_at,duration_minutes) values($1,$2,$3,$4,45)', [connection.id, client, otherTherapist, future()]), '23503');
  await rejectsCode(db.query('insert into public.pre_session_notes(session_id,user_id,body) values($1,$2,$3)', [session.id, stranger, 'Forged']), '23503');
  await rejectsCode(db.query('update public.clients set therapist_id=$1 where id=$2', [otherTherapist, clientId]), '23503');
  await rejectsCode(db.query('update public.therapy_connections set user_id=$1 where id=$2', [stranger, connection.id]), '23503');
  await asUser(therapist, () => rejectsCode(db.query('delete from public.clients where id=$1', [clientId]), '23503'));
});

test('scheduling validates all required inputs and notes cannot forge submission or review timestamps', async () => {
  const { session, connection } = await scheduled();
  await asUser(client, async () => {
    for (const args of [
      [null, future(), 50], [connection.id, null, 50], [connection.id, future(-1), 50],
      [connection.id, future(367), 50], [connection.id, 'infinity', 50],
      [connection.id, future(), null], [connection.id, future(), 14], [connection.id, future(), 181],
    ]) await rejectsCode(rpc('save_therapy_session', args), '22023');
    for (const args of [
      [null, 'Note', true], [session.id, null, true], [session.id, '', true],
      [session.id, ' \t\r\n ', true], [session.id, 'x'.repeat(2001), true], [session.id, 'Note', null],
    ]) await rejectsCode(rpc('save_pre_session_note', args), '22023');
    for (const name of ['preview_therapy_invite', 'accept_therapy_invite', 'revoke_therapy_connection', 'cancel_therapy_session', 'mark_pre_session_note_reviewed']) {
      await rejectsCode(rpc(name, [null]), '22023');
    }
    const max = await rpc('save_pre_session_note', [session.id, 'x'.repeat(2000), true]);
    assert.equal(max.body.length, 2000);
    assert.equal(max.reviewed_at, null);
    assert.ok(Math.abs(Date.parse(max.submitted_at) - Date.now()) < 10000);
    await rejectsCode(db.query("update public.pre_session_notes set reviewed_at='2000-01-01', submitted_at='2000-01-01', status='submitted', user_id=$1 where session_id=$2", [therapist, session.id]), '42501');
  });
  await asUser(therapist, async () => {
    for (const args of [[null, 'Name'], [connection.client_id, null], [connection.client_id, ' \t '], [connection.client_id, 'x'.repeat(121)]]) {
      await rejectsCode(rpc('create_therapy_invite', args), '22023');
    }
  });
});

test('either participant can reschedule; cancellation preserves history and blocks edits or revival', async () => {
  const { session, connection } = await scheduled();
  const note = await asUser(client, () => rpc('save_pre_session_note', [session.id, 'Please discuss this.', true]));
  const rescheduled = await asUser(client, () => rpc('save_therapy_session', [connection.id, future(4), 60, session.id]));
  assert.equal(rescheduled.id, session.id);
  assert.equal(rescheduled.duration_minutes, 60);
  assert.ok(Date.parse(rescheduled.starts_at) > Date.parse(session.starts_at));
  const elsewhere = await connected();
  await asUser(therapist, () => rejectsCode(rpc('save_therapy_session', [elsewhere.connection.id, future(), 50, session.id]), 'P0002'));
  const cancelled = await asUser(therapist, () => rpc('cancel_therapy_session', [session.id]));
  assert.equal(cancelled.status, 'cancelled');
  await asUser(client, async () => {
    assert.equal((await visible('pre_session_notes', 'session_id', session.id)).length, 1);
    await rejectsCode(rpc('save_pre_session_note', [session.id, 'Edit cancelled', true]), 'P0002');
    await rejectsCode(rpc('save_therapy_session', [connection.id, future(), 45, session.id]), 'P0002');
    assert.equal((await rpc('cancel_therapy_session', [session.id])).status, 'cancelled');
    const created = await rpc('save_therapy_session', [connection.id, future(), 15]);
    assert.equal(created.user_id, client);
    assert.equal(created.therapist_id, therapist);
    assert.equal((await rpc('cancel_therapy_session', [created.id])).status, 'cancelled');
  });
  await asUser(therapist, async () => assert.ok((await rpc('mark_pre_session_note_reviewed', [session.id, note.updated_at])).reviewed_at));
});

test('past sessions cannot be rescheduled, cancelled, or edited; historical shared notes remain reviewable', async () => {
  const { connection, session } = await scheduled();
  const note = await asUser(client, () => rpc('save_pre_session_note', [session.id, 'Historical note', true]));
  await db.query("update public.therapy_sessions set starts_at=now()-interval '1 day' where id=$1", [session.id]);
  for (const user of [client, therapist]) await asUser(user, async () => {
    await rejectsCode(rpc('save_therapy_session', [connection.id, future(), 45, session.id]), 'P0002');
    await rejectsCode(rpc('cancel_therapy_session', [session.id]), 'P0002');
  });
  await asUser(client, () => rejectsCode(rpc('save_pre_session_note', [session.id, 'Late edit', true]), 'P0002'));
  await asUser(therapist, async () => assert.ok((await rpc('mark_pre_session_note_reviewed', [session.id, note.updated_at])).reviewed_at));
});

test('stale drafts and reviews cannot overwrite or acknowledge a revision they have not loaded', async () => {
  const { session } = await scheduled();
  await asUser(client, () => rejectsCode(rpc('save_pre_session_note', [session.id, 'No current note exists', true, future(-1)]), '40001'));
  const initial = await asUser(client, () => rpc('save_pre_session_note', [session.id, 'First shared note', true]));
  const revised = await asUser(client, () => rpc('save_pre_session_note', [session.id, 'New content the therapist has not read', true, initial.updated_at]));
  assert.notEqual(revised.updated_at, initial.updated_at);
  await asUser(client, async () => {
    await rejectsCode(rpc('save_pre_session_note', [session.id, 'Stale tab overwrite', true, initial.updated_at]), '40001');
    await rejectsCode(rpc('save_pre_session_note', [session.id, 'Missing revision overwrite', true]), '40001');
  });
  await asUser(therapist, async () => {
    await rejectsCode(rpc('mark_pre_session_note_reviewed', [session.id, initial.updated_at]), '40001');
    await rejectsCode(rpc('mark_pre_session_note_reviewed', [session.id]), '40001');
    const [unchanged] = await visible('pre_session_notes', 'session_id', session.id);
    assert.equal(unchanged.body, revised.body);
    assert.equal(unchanged.reviewed_at, null);
    const reviewed = await rpc('mark_pre_session_note_reviewed', [session.id, revised.updated_at]);
    assert.notEqual(reviewed.updated_at, revised.updated_at);
    assert.equal(reviewed.reviewed_at, reviewed.updated_at);
    await rejectsCode(rpc('mark_pre_session_note_reviewed', [session.id, revised.updated_at]), '40001');
  });
  await asUser(client, () => rejectsCode(rpc('save_pre_session_note', [session.id, 'Edit from before review', true, revised.updated_at]), '40001'));
});

test('revoking cancels only future sessions, removes therapist access, and preserves the client notes', async () => {
  const { connection, session } = await scheduled();
  const past = await asUser(client, () => rpc('save_therapy_session', [connection.id, future(3), 50]));
  await asUser(client, () => rpc('save_pre_session_note', [session.id, 'Keep my own copy.', true]));
  await asUser(client, () => rpc('save_pre_session_note', [past.id, 'History.', true]));
  await db.query("update public.therapy_sessions set starts_at=now()-interval '1 day' where id=$1", [past.id]);
  const revoked = await asUser(client, () => rpc('revoke_therapy_connection', [connection.id]));
  assert.ok(revoked.revoked_at);
  await asUser(client, async () => {
    assert.equal((await visible('therapy_connections', 'id', connection.id)).length, 1);
    assert.equal((await visible('therapy_sessions', 'id', session.id))[0].status, 'cancelled');
    assert.equal((await visible('therapy_sessions', 'id', past.id))[0].status, 'scheduled');
    assert.equal((await visible('pre_session_notes', 'session_id', session.id))[0].body, 'Keep my own copy.');
    assert.equal((await visible('pre_session_notes', 'session_id', past.id))[0].body, 'History.');
  });
  await asUser(therapist, async () => {
    assert.deepEqual(await visible('therapy_connections', 'id', connection.id), []);
    assert.deepEqual(await visible('therapy_sessions', 'connection_id', connection.id), []);
    assert.deepEqual(await visible('pre_session_notes', 'session_id', session.id), []);
    assert.deepEqual(await visible('pre_session_notes', 'session_id', past.id), []);
    await rejectsCode(rpc('mark_pre_session_note_reviewed', [session.id]), 'P0002');
  });
  for (const user of [client, therapist]) await asUser(user, async () => {
    await rejectsCode(rpc('save_therapy_session', [connection.id, future(), 45]), 'P0002');
    await rejectsCode(rpc('save_therapy_session', [connection.id, future(), 45, session.id]), 'P0002');
    await rejectsCode(rpc('cancel_therapy_session', [session.id]), 'P0002');
    await rejectsCode(rpc('save_pre_session_note', [session.id, 'After revocation', true]), 'P0002');
  });
});

test('deleting either auth account cascades linked private data while unrelated relationships survive', async () => {
  const disposableTherapist = id(900), disposableClient = id(901);
  await db.query('insert into auth.users(id) values($1),($2)', [disposableTherapist, disposableClient]);
  const byTherapist = await scheduled(disposableTherapist, client);
  const byClient = await scheduled(therapist, disposableClient);
  const unrelated = await scheduled(otherTherapist, stranger);
  const waiting = await pending(disposableTherapist);
  for (const [record, user] of [[byTherapist, client], [byClient, disposableClient], [unrelated, stranger]]) {
    await asUser(user, () => rpc('save_pre_session_note', [record.session.id, 'Private note.', true]));
  }
  await db.query('delete from auth.users where id=$1 or id=$2', [disposableTherapist, disposableClient]);
  for (const record of [byTherapist, byClient]) {
    assert.deepEqual(await visible('therapy_connections', 'id', record.connection.id), []);
    assert.deepEqual(await visible('therapy_sessions', 'id', record.session.id), []);
    assert.deepEqual(await visible('pre_session_notes', 'session_id', record.session.id), []);
  }
  assert.deepEqual(await visible('therapy_connection_invites', 'token', waiting.token), []);
  assert.equal((await visible('therapy_connections', 'id', unrelated.connection.id)).length, 1);
  assert.equal((await visible('therapy_sessions', 'id', unrelated.session.id)).length, 1);
  assert.equal((await visible('pre_session_notes', 'session_id', unrelated.session.id)).length, 1);
});
