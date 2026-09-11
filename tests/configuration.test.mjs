import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, copyFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function configure(env) {
  const root = mkdtempSync(join(tmpdir(), 'siggy-config-'));
  try {
    mkdirSync(join(root, 'scripts'));
    mkdirSync(join(root, 'src/environments'), { recursive: true });
    copyFileSync(new URL('../scripts/configure-environment.mjs', import.meta.url), join(root, 'scripts/configure-environment.mjs'));
    const output = join(root, 'src/environments/environment.ts');
    writeFileSync(output, '// manual configuration');
    const cleanEnv = { ...process.env };
    delete cleanEnv.SIGGY_SUPABASE_URL;
    delete cleanEnv.SIGGY_SUPABASE_ANON_KEY;
    const result = spawnSync(process.execPath, ['scripts/configure-environment.mjs'], { cwd: root, env: { ...cleanEnv, ...env }, encoding: 'utf8' });
    return { ...result, source: readFileSync(output, 'utf8') };
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test('preserves manual configuration when environment variables are absent', () => {
  const result = configure({});
  assert.equal(result.status, 0);
  assert.equal(result.source, '// manual configuration');
});
test('writes only validated public configuration', () => {
  const result = configure({ SIGGY_SUPABASE_URL: 'https://siggy-e2e.supabase.co/', SIGGY_SUPABASE_ANON_KEY: 'sb_publishable_test_fixture' });
  assert.equal(result.status, 0);
  assert.match(result.source, /https:\/\/siggy-e2e.supabase.co"/);
});
test('rejects missing, secret, and service-role keys before writing', () => {
  const jwt = `header.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.signature`;
  for (const key of ['', 'sb_secret_example', jwt]) {
    const result = configure({ SIGGY_SUPABASE_URL: 'https://siggy-e2e.supabase.co', SIGGY_SUPABASE_ANON_KEY: key });
    assert.notEqual(result.status, 0);
    assert.equal(result.source, '// manual configuration');
  }
});
test('rejects remote HTTP and credential-bearing or path URLs', () => {
  for (const url of ['http://example.com', 'https://user:pass@example.com', 'https://example.com/rest/v1', 'https://example.com/?token=secret']) {
    assert.notEqual(configure({ SIGGY_SUPABASE_URL: url, SIGGY_SUPABASE_ANON_KEY: 'sb_publishable_test_fixture' }).status, 0);
  }
});
