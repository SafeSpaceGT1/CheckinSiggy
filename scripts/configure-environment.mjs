import { writeFileSync } from 'node:fs';

// Only public Supabase configuration belongs in the browser bundle.
const url = process.env.SIGGY_SUPABASE_URL?.trim();
const key = process.env.SIGGY_SUPABASE_ANON_KEY?.trim();
if (url === undefined && key === undefined) {
  console.info('Using src/environments/environment.ts.');
} else {
  if (!url || !key) throw new Error('Set both SIGGY_SUPABASE_URL and SIGGY_SUPABASE_ANON_KEY.');
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname))) {
    throw new Error('Use HTTPS for Supabase (HTTP is allowed only for local development).');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash || !['', '/'].includes(parsed.pathname)) {
    throw new Error('Use the Supabase project origin without credentials, path, query, or fragment.');
  }
  let publicKey = key.startsWith('sb_publishable_') && key.length > 20;
  if (!publicKey) {
    try { publicKey = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role === 'anon'; }
    catch { publicKey = false; }
  }
  if (!publicKey) throw new Error('Use a Supabase publishable or anon key, never a secret/service-role key.');
  writeFileSync(new URL('../src/environments/environment.ts', import.meta.url),
    '// Generated public browser configuration. Never add server-side secrets.\n' +
    `export const environment = ${JSON.stringify({ supabaseUrl: parsed.origin, supabasePublishableKey: key }, null, 2)};\n`);
  console.info('Public Supabase configuration generated.');
}
