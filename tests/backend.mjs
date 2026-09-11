import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';

const db = new PGlite();
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const alice = id(1), bob = id(2);
const childTables = [
  ['crisis_warning_signs', 'text'], ['crisis_coping_strategies', 'text'],
  ['crisis_distractions', 'name'], ['crisis_support_contacts', 'name'],
  ['crisis_professional_contacts', 'name'], ['crisis_safety_steps', 'text'],
  ['crisis_reasons_for_living', 'text'],
];
const asRole = async (role, user, work) => {
  await db.exec(`set role ${role}`);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user ?? '']);
  try { return await work(); } finally {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  }
};
const rejectsCode = (work, code) => assert.rejects(work, error => error.code === code);

before(async () => {
  await db.exec(await readFile(new URL('../supabase/tests/database/bootstrap.sql', import.meta.url), 'utf8'));
  const migrations = (await readdir(new URL('../supabase/migrations/', import.meta.url))).filter(name => name.endsWith('.sql')).sort();
  for (const migration of migrations) {
    await db.exec(await readFile(new URL(`../supabase/migrations/${migration}`, import.meta.url), 'utf8'));
  }
  await db.query('insert into auth.users(id) values ($1),($2)', [alice, bob]);
  for (const [user, n] of [[alice, 10], [bob, 20]]) {
    await db.query('insert into public.mood_entries(id,user_id,value,emoji) values($1,$2,3,$3)', [id(n), user, '🙂']);
    await db.query('insert into public.journal_entries(id,user_id,content) values($1,$2,$3)', [id(n+1), user, 'Private journal']);
    await db.query('insert into public.crisis_plans(id,user_id) values($1,$2)', [id(n+2), user]);
    await db.query('insert into public.clients(id,therapist_id,name) values($1,$2,$3)', [id(n+3), user, 'Client']);
    await db.query('insert into public.wellness_goals(id,user_id,title) values($1,$2,$3)', [id(n+4), user, 'Walk']);
    for (const [table, content] of childTables) {
      await db.query(`insert into public.${table}(user_id,plan_id,${content}) values($1,$2,$3)`, [user, id(n+2), `${user} private plan step`]);
    }
    await db.query('insert into public.crisis_plan_shares(user_id,plan_id,token) values($1,$2,$3)', [user, id(n+2), `token-${user}`]);
    await db.query('insert into public.sentiment_analyses(user_id,journal_entry_id,sentiment) values($1,$2,$3)', [user, id(n+1), 'neutral']);
    await db.query('insert into public.soap_notes(therapist_id,client_id) values($1,$2)', [user, id(n+3)]);
  }
});
after(async () => { await db.close(); });

test('all migrations apply to actual PostgreSQL and private tables enable RLS', async () => {
  const { rows } = await db.query("select relname, relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'");
  assert.equal(rows.length, 22);
  for (const row of rows) {
    assert.equal(row.relrowsecurity, true, row.relname);
    const privileges = (await db.query("select has_table_privilege('authenticated', $1, 'TRUNCATE') as can_truncate", [row.relname])).rows[0];
    assert.equal(privileges.can_truncate, false, row.relname);
  }
});

test('authenticated reads return only the caller records across protected tables', async () => {
  await asRole('authenticated', alice, async () => {
    for (const table of ['mood_entries','journal_entries','sentiment_analyses','crisis_plans','crisis_plan_shares','clients','soap_notes','wellness_goals', ...childTables.map(([t]) => t)]) {
      const { rows } = await db.query(`select * from public.${table}`);
      assert.equal(rows.length, 1, table);
      assert.equal(rows[0].user_id ?? rows[0].therapist_id, alice, table);
    }
  });
});

test('another user cannot read, overwrite, delete, or claim ownership of a mood', async () => {
  await asRole('authenticated', alice, async () => {
    assert.equal((await db.query('select * from public.mood_entries where id=$1', [id(20)])).rows.length, 0);
    assert.equal((await db.query('update public.mood_entries set value=1 where id=$1 returning id', [id(20)])).rows.length, 0);
    assert.equal((await db.query('delete from public.mood_entries where id=$1 returning id', [id(20)])).rows.length, 0);
    await rejectsCode(db.query('update public.mood_entries set user_id=$1 where id=$2', [bob, id(10)]), '42501');
    await rejectsCode(db.query("insert into public.mood_entries(user_id,value,emoji) values($1,3,'x')", [bob]), '42501');
  });
});

test('forged crisis share and all forged child-parent relationships are rejected', async () => {
  await asRole('authenticated', alice, async () => {
    await rejectsCode(db.query('insert into public.crisis_plan_shares(user_id,plan_id,token) values($1,$2,$3)', [alice, id(22), 'forged-share']), '23503');
    for (const [table, content] of childTables) {
      await rejectsCode(db.query(`insert into public.${table}(user_id,plan_id,${content}) values($1,$2,'forged')`, [alice, id(22)]), '23503');
      await rejectsCode(db.query(`update public.${table} set plan_id=$1 where user_id=$2`, [id(22), alice]), '23503');
    }
  });
});

test('sentiment and session notes cannot attach to another owner parent', async () => {
  await db.query("insert into public.journal_entries(id,user_id,content) values($1,$2,'Unanalyzed entry')", [id(25), bob]);
  await asRole('authenticated', alice, async () => {
    await rejectsCode(db.query('update public.sentiment_analyses set journal_entry_id=$1 where user_id=$2', [id(25), alice]), '23503');
    await rejectsCode(db.query('insert into public.soap_notes(therapist_id,client_id) values($1,$2)', [alice, id(23)]), '23503');
  });
  await db.query('delete from public.journal_entries where id=$1', [id(25)]);
});

test('anonymous sharing exposes exactly the valid shared plan and rejects revoked/expired tokens', async () => {
  await asRole('anon', null, async () => {
    await rejectsCode(db.query('select * from public.crisis_plans'), '42501');
    const shared = (await db.query('select public.get_shared_plan($1) as plan', [`token-${alice}`])).rows[0].plan;
    assert.equal(shared.warning_signs.length, 1);
    assert.match(shared.warning_signs[0].text, new RegExp(alice));
    assert.equal(shared.user_id, undefined);
    assert.equal((await db.query("select public.get_shared_plan('unknown') as plan")).rows[0].plan, null);
  });
  await db.query('update public.crisis_plan_shares set revoked=true where user_id=$1', [alice]);
  await asRole('anon', null, async () => {
    assert.equal((await db.query('select public.get_shared_plan($1) as plan', [`token-${alice}`])).rows[0].plan, null);
  });
  await db.query("update public.crisis_plan_shares set revoked=false, expires_at=now()-interval '1 second' where user_id=$1", [alice]);
  await asRole('anon', null, async () => {
    assert.equal((await db.query('select public.get_shared_plan($1) as plan', [`token-${alice}`])).rows[0].plan, null);
  });
});

test('atomic goal completion toggles current DB state and enforces owner/date', async () => {
  await asRole('authenticated', alice, async () => {
    const toggle = () => db.query('select * from public.toggle_wellness_goal_today($1,current_date)', [id(14)]);
    assert.equal((await toggle()).rows[0].completed_dates.length, 1);
    assert.equal((await toggle()).rows[0].completed_dates.length, 0);
    await rejectsCode(db.query('select public.toggle_wellness_goal_today($1,current_date)', [id(24)]), 'P0002');
    await rejectsCode(db.query('select public.toggle_wellness_goal_today($1,current_date+2)', [id(14)]), '22023');
    await rejectsCode(db.query('select public.toggle_wellness_goal_today($1,null)', [id(14)]), '22023');
  });
  await asRole('anon', null, async () => {
    await rejectsCode(db.query('select public.toggle_wellness_goal_today($1,current_date)', [id(14)]), '42501');
  });
});

test('account deletion cascades through owned rows without removing another user data', async () => {
  await db.query('delete from auth.users where id=$1', [alice]);
  for (const table of ['mood_entries','journal_entries','sentiment_analyses','crisis_plans','crisis_plan_shares','clients','soap_notes','wellness_goals', ...childTables.map(([t]) => t)]) {
    const { rows } = await db.query(`select * from public.${table}`);
    assert.equal(rows.length, 1, table);
    assert.equal(rows[0].user_id ?? rows[0].therapist_id, bob, table);
  }
});
