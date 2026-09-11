// Execute the actual edge handlers with a local auth/database/provider boundary.
// PostgreSQL ownership/RLS is separately exercised by tests/backend.mjs.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const userId = '00000000-0000-4000-8000-000000000001';
const entryId = '00000000-0000-4000-8000-000000000011';
const handlers = new Map();
let active;
let registeredHandler;
const originalFetch = globalThis.fetch;
const originalDeno = globalThis.Deno;
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('npm:@supabase/supabase-js@')) {
      return { url: 'data:text/javascript,export const createClient = (...args) => globalThis.__siggyEdgeTest.createClient(...args);', shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

function query(table) {
  const filters = [];
  let from = 0, to = Infinity;
  let upsert;
  const execute = () => {
    active.queries.push({ table, filters: [...filters], upsert });
    if (active.dbError) return { data: null, error: { code: 'XX000', message: 'private database details' } };
    let rows = table === 'mood_entries' ? active.moods : table === 'journal_entries' ? active.journals : [];
    if (upsert) return { data: upsert, error: null };
    for (const [op, field, value] of filters) {
      if (op === 'eq') rows = rows.filter(row => row[field] === value);
      if (op === 'gte') rows = rows.filter(row => row[field] >= value);
      if (op === 'lte') rows = rows.filter(row => row[field] <= value);
      if (op === 'lt') rows = rows.filter(row => row[field] < value);
    }
    return { data: rows.slice(from, to + 1), error: null };
  };
  const builder = {
    select() { return builder; },
    eq(field, value) { filters.push(['eq', field, value]); return builder; },
    gte(field, value) { filters.push(['gte', field, value]); return builder; },
    lte(field, value) { filters.push(['lte', field, value]); return builder; },
    lt(field, value) { filters.push(['lt', field, value]); return builder; },
    order() { return builder; },
    limit(count) { to = count - 1; return builder; },
    range(first, last) { from = first; to = last; return builder; },
    upsert(row) { upsert = row; return builder; },
    single() {
      const result = execute();
      if (upsert || result.error) return Promise.resolve(result);
      return Promise.resolve(result.data.length ? { data: result.data[0], error: null }
        : { data: null, error: { code: 'PGRST116' } });
    },
    then(resolve, reject) { return Promise.resolve(execute()).then(resolve, reject); },
  };
  return builder;
}

function reset(overrides = {}) {
  active = {
    authenticated: true, dbError: false, aiKey: undefined, provider: undefined,
    queries: [], deleted: [], fetchCalls: 0,
    moods: [{ id: entryId, user_id: userId, value: 3, emoji: '🙂', notes: null,
      rating_10: null, tags: [], add_to_next_session: false, created_at: new Date().toISOString() }],
    journals: [{ id: entryId, user_id: userId, content: 'A personal reflection.', created_at: new Date().toISOString() }],
    ...overrides,
  };
}

before(async () => {
  globalThis.__siggyEdgeTest = {
    createClient() {
      return {
        auth: {
          getUser: async () => active.authenticated ? { data: { user: { id: userId } }, error: null }
            : { data: { user: null }, error: { message: 'invalid token' } },
          admin: { deleteUser: async id => { active.deleted.push(id); return { error: null }; } },
        },
        from: query,
      };
    },
  };
  globalThis.Deno = {
    env: { get: key => key === 'LOVABLE_API_KEY' ? active?.aiKey : key === 'GEMINI_API_KEY' ? undefined : 'test-config' },
    serve: handler => { registeredHandler = handler; },
  };
  globalThis.fetch = async () => {
    active.fetchCalls++;
    if (active.provider instanceof Error) throw active.provider;
    if (!active.provider) throw new Error('Unexpected outbound request: no network permitted in tests');
    return active.provider.clone();
  };
  for (const route of ['analyze-sentiment', 'analyze-journal-history', 'siggy-insight', 'delete-account']) {
    await import(`../functions/${route}/index.ts`);
    handlers.set(route, registeredHandler);
  }
});
after(() => {
  hook.deregister();
  globalThis.fetch = originalFetch;
  globalThis.Deno = originalDeno;
  delete globalThis.__siggyEdgeTest;
});

const invoke = (route, body = {}, { method = 'POST', bearer = true, raw = false } = {}) => handlers.get(route)(
  new Request(`https://example.test/${route}`, { method,
    headers: bearer ? { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' } : {},
    ...(method === 'GET' || method === 'OPTIONS' ? {} : { body: raw ? body : JSON.stringify(body) }),
  }),
);

test('all real edge handlers deny GET, missing JWT and failed auth lookup', async () => {
  for (const route of handlers.keys()) {
    reset();
    assert.equal((await invoke(route, {}, { method: 'GET' })).status, 405, route);
    assert.equal((await invoke(route, {}, { bearer: false })).status, 401, route);
    reset({ authenticated: false });
    assert.equal((await invoke(route)).status, 401, route);
    assert.equal(active.queries.length, 0);
    assert.equal(active.deleted.length, 0);
  }
});

test('real analysis handlers reject malformed JSON and invalid options with 400', async () => {
  for (const route of ['analyze-sentiment', 'analyze-journal-history', 'siggy-insight']) {
    reset();
    assert.equal((await invoke(route, '{bad', { raw: true })).status, 400, route);
    assert.equal((await invoke(route, 'null', { raw: true })).status, 400, route);
    assert.equal(active.queries.length, 0);
  }
  reset();
  assert.equal((await invoke('analyze-sentiment', { entryId: 'invalid' })).status, 400);
  assert.equal((await invoke('analyze-journal-history', { limit: 5.5 })).status, 400);
  assert.equal((await invoke('siggy-insight', { rangeDays: 14 })).status, 400);
});

test('sentiment queries the authenticated owner and rejects another account entry', async () => {
  reset({ journals: [{ id: entryId, user_id: 'another-user', content: 'not yours' }] });
  assert.equal((await invoke('analyze-sentiment', { entryId })).status, 404);
  assert.ok(active.queries[0].filters.some(([op, key, value]) => op === 'eq' && key === 'user_id' && value === userId));
  assert.equal(active.fetchCalls, 0);
});

test('sentiment stores sanitized provider results using the authenticated owner', async () => {
  reset({ aiKey: 'test-key', provider: Response.json({ choices: [{ message: { content:
    JSON.stringify({ sentiment: 'mixed', confidence: 3, summary: 'A thoughtful entry.', keywords: ['calm'] }) } }] }) });
  const response = await invoke('analyze-sentiment', { entryId, userId: 'forged' });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.analysis.user_id, userId);
  assert.equal(payload.analysis.journal_entry_id, entryId);
  assert.equal(payload.analysis.confidence, 1);
  assert.equal(payload.analysis.source, 'ai');
});

test('insight returns successful statistics when AI is absent, throttled, or unavailable', async () => {
  for (const overrides of [{}, { aiKey: 'key', provider: new Response('{}', { status: 429 }) },
    { aiKey: 'key', provider: new Error('provider timeout with private context') }]) {
    reset(overrides);
    const response = await invoke('siggy-insight', { rangeDays: 7 });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.stats.total_check_ins, 1);
    assert.equal(payload.stats.series.at(-1).count, 1);
    assert.equal(payload.narrative, null);
    assert.ok(payload.narrative_error);
    assert.ok(active.queries.every(q => q.filters.some(([op, key, value]) => op === 'eq' && key === 'user_id' && value === userId)));
  }
});

test('database failures never masquerade as empty successful insights or leak SQL details', async () => {
  for (const route of ['siggy-insight', 'analyze-journal-history', 'analyze-sentiment']) {
    reset({ dbError: true });
    const response = await invoke(route, { entryId });
    assert.equal(response.status, 500, route);
    assert.deepEqual(await response.json(), { error: 'database_error' });
    assert.equal(active.fetchCalls, 0);
  }
});

test('account deletion uses only the verified caller identity', async () => {
  reset();
  const response = await invoke('delete-account', { userId: 'another-user' });
  assert.equal(response.status, 200);
  assert.deepEqual(active.deleted, [userId]);
  assert.deepEqual(await response.json(), { deleted: true });
});
