import test from 'node:test';
import assert from 'node:assert/strict';
import { buildQuotes, computeStats, computeConcerns, insightRange, sanitizeNarrative } from '../functions/_shared/insight.ts';
import { guardRequest, readObjectBody, errorResponse, isUuid, RequestError } from '../functions/_shared/http.ts';
import { readAllPages } from '../functions/_shared/pagination.ts';
import { parseModelJson } from '../functions/_shared/ai.ts';

const mood = (overrides = {}) => ({ id: 'a', value: 3, emoji: '🙂', notes: null, rating_10: null,
  tags: [], add_to_next_session: false, created_at: '2026-09-11T12:00:00Z', ...overrides });
const post = (body) => new Request('https://example.test', { method: 'POST', headers: { Authorization: 'Bearer token' }, body });

test('calendar range and series include today and exactly N UTC dates', () => {
  const range = insightRange(7, new Date('2026-09-11T23:30:00Z'));
  assert.equal(range.start.toISOString(), '2026-09-05T00:00:00.000Z');
  assert.equal(range.priorStart.toISOString(), '2026-08-29T00:00:00.000Z');
  const stats = computeStats([mood()], [], 7, range.start);
  assert.equal(stats.series.length, 7);
  assert.deepEqual(stats.series.at(-1), { date: '2026-09-11', avg: 6, count: 1 });
  assert.equal(stats.coverage_days, 1);
});

test('stats use detailed rating, repeated daily entries, missing days and raw comparison means', () => {
  const rows = [mood({ rating_10: 7 }), mood({ rating_10: 8 }), mood({ rating_10: 8 })];
  const stats = computeStats(rows, [mood({ rating_10: 5 }), mood({ rating_10: 5 }), mood({ rating_10: 6 })], 7, new Date('2026-09-05'));
  assert.equal(stats.total_check_ins, 3);
  assert.equal(stats.mean, 7.7);
  assert.equal(stats.median, 8);
  assert.equal(stats.delta_vs_prior, 2.3);
  assert.equal(stats.trend, null);
  assert.equal(stats.series[0].avg, null);
  assert.equal(stats.series.at(-1).count, 3);
});

test('concerns are review flags tied to original source and quotes are bounded', () => {
  const moods = [mood({ id: 'low', rating_10: 2, add_to_next_session: true, notes: 'I feel hopeless today.' })];
  const journals = [{ id: 'journal', content: 'I want to die', created_at: '2026-09-10T00:00:00Z' }];
  const concerns = computeConcerns(moods, journals);
  assert.deepEqual(concerns[0].reasons, ['low_rating', 'flagged_for_session', 'safety_language']);
  assert.equal(concerns[0].source_id, 'm:low');
  assert.equal(concerns[1].source_id, 'j:journal');
  assert.equal(buildQuotes(moods, journals, concerns)[0].text, moods[0].notes);
});

const narrative = () => Object.fromEntries(['data_coverage', 'observed_patterns', 'client_reported_concerns', 'client_strengths', 'session_prompts']
  .map(key => [key, { text: 'You recorded a helpful reflection.', source_ids: ['j:known'] }]));

test('narrative rejects fabricated citations and malformed provider output', () => {
  assert.ok(sanitizeNarrative(narrative(), new Set(['j:known'])));
  assert.equal(sanitizeNarrative(narrative(), new Set()), null);
  assert.equal(sanitizeNarrative(null, new Set()), null);
  assert.equal(sanitizeNarrative({ data_coverage: { text: 'Anything', source_ids: [] } }, new Set()), null);
  const clinical = narrative();
  for (const section of Object.values(clinical)) section.text = 'A diagnosis of a disorder';
  assert.equal(sanitizeNarrative(clinical, new Set(['j:known'])), null);
});

test('HTTP rejects destructive GET and missing bearer before serving route', async () => {
  assert.equal(guardRequest(new Request('https://example.test')).status, 405);
  assert.equal(guardRequest(new Request('https://example.test', { method: 'POST' })).status, 401);
  assert.equal(guardRequest(new Request('https://example.test', { method: 'OPTIONS' })).status, 204);
  assert.equal(guardRequest(post('{}')), null);
  assert.equal(errorResponse(new Error('secret SQL detail')).status, 500);
  assert.deepEqual(await errorResponse(new Error('secret')).json(), { error: 'internal_error' });
});

test('JSON bodies reject null, arrays, invalid syntax and oversized bytes', async () => {
  assert.deepEqual(await readObjectBody(post('{"rangeDays":7}')), { rangeDays: 7 });
  for (const body of ['null', '[]', '"text"', '{bad']) {
    await assert.rejects(readObjectBody(post(body)), error => error instanceof RequestError && error.status === 400);
  }
  await assert.rejects(readObjectBody(post('x'.repeat(4097))), error => error.status === 413);
  assert.equal(isUuid('00000000-0000-4000-8000-000000000001'), true);
  assert.equal(isUuid('invalid'), false);
});

test('pagination reads beyond Supabase default row cap and fails on a failed page', async () => {
  const all = Array.from({ length: 1201 }, (_, i) => ({ id: i }));
  const calls = [];
  const rows = await readAllPages(async (from, to) => {
    calls.push([from, to]);
    return { data: all.slice(from, to + 1), error: null };
  });
  assert.equal(rows.length, 1201);
  assert.deepEqual(calls, [[0, 499], [500, 999], [1000, 1499]]);
  await assert.rejects(readAllPages(async () => ({ data: null, error: new Error('db down') })), /database_error/);
});

test('JSON model parser handles fenced objects and rejects unusable output', () => {
  assert.deepEqual(parseModelJson('```json\n{"sentiment":"mixed"}\n```'), { sentiment: 'mixed' });
  assert.equal(parseModelJson('null'), null);
  assert.equal(parseModelJson('{bad}'), null);
});
