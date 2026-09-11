import { expect, test as base, type Page, type Route } from '@playwright/test';

// Reserved synthetic account, unrelated to a real Supabase project or patient.
export const SUPABASE_ORIGIN = 'https://siggy-e2e.supabase.co';
export const USER_ID = '11111111-1111-4111-8111-111111111111';
export const USER_EMAIL = 'synthetic.tester@example.invalid';
export const UNCONFIGURED = process.env.SIGGY_E2E_UNCONFIGURED === '1';
type Row = Record<string, any>;
export type ApiCall = { path: string; method: string; body: Row; search: URLSearchParams };

function session() {
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: USER_ID, exp: expires, role: 'authenticated' })}.synthetic-signature`;
  return {
    access_token: token, refresh_token: 'synthetic-refresh-token', token_type: 'bearer',
    expires_in: 3600, expires_at: expires,
    user: {
      id: USER_ID, email: USER_EMAIL, aud: 'authenticated', role: 'authenticated',
      app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {},
      created_at: '2026-01-01T00:00:00.000Z',
    },
  };
}

const TABLES = [
  'mood_entries', 'journal_entries', 'sentiment_analyses', 'wellness_goals',
  'meditation_sessions', 'exercise_logs', 'reminders', 'crisis_plans',
  'crisis_warning_signs', 'crisis_coping_strategies', 'crisis_distractions',
  'crisis_support_contacts', 'crisis_professional_contacts', 'crisis_safety_steps', 'crisis_reasons_for_living',
  'crisis_plan_shares', 'clients', 'soap_notes',
];

export class MockSupabase {
  readonly rows: Record<string, Row[]> = Object.fromEntries(TABLES.map(table => [table, []]));
  readonly calls: ApiCall[] = [];
  readonly unexpected: string[] = [];
  readonly errors: string[] = [];
  readonly unavailableTables = new Set<string>();
  failNext: { table: string; method: string; message: string } | null = null;
  signInError: string | null = null;
  signupRequiresConfirmation = true;
  analysisUnavailable = false;
  private sequence = 1;

  constructor(readonly page: Page) {}

  async install({ signedIn = true, role = 'client' } = {}) {
    this.page.on('pageerror', error => this.errors.push(error.message));
    await this.page.addInitScript(({ authSession, signedIn, role }) => {
      // Seed only once, so reloads also test genuine persistence and sign-out.
      if (!sessionStorage.getItem('siggy-e2e-seeded')) {
        localStorage.clear();
        if (signedIn) {
          localStorage.setItem('sb-siggy-e2e-auth-token', JSON.stringify(authSession));
          localStorage.setItem(`siggy:role:${authSession.user.id}`, role);
          localStorage.setItem('userRole', role);
        }
        localStorage.setItem('siggy:settings', JSON.stringify({
          theme: 'light', soundEnabled: false, hapticsEnabled: false, reviewIntervalDays: 90,
        }));
        sessionStorage.setItem('siggy-e2e-seeded', '1');
      }
    }, { authSession: session(), signedIn, role });

    await this.page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === SUPABASE_ORIGIN) return this.handle(route, url);
      // Keep the browser suite independent of the optional web-font provider.
      if (url.origin === 'https://fonts.googleapis.com') {
        return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
      }
      if (url.origin === 'http://127.0.0.1:4173' || url.protocol === 'data:' || url.protocol === 'blob:') {
        return route.continue();
      }
      // Fail closed: no test request can touch a live account/data service.
      this.unexpected.push(route.request().url());
      return route.abort('blockedbyclient');
    });
  }

  writes(table: string, method = 'POST') {
    return this.calls.filter(call => call.path === `/rest/v1/${table}` && call.method === method);
  }

  private async handle(route: Route, url: URL) {
    const request = route.request();
    const method = request.method();
    const headers = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    };
    const reply = (data: unknown, status = 200) => route.fulfill({
      status, headers, contentType: 'application/json', body: JSON.stringify(data),
    });
    if (method === 'OPTIONS') return reply({});
    const body = request.postDataJSON() ?? {};
    this.calls.push({ path: url.pathname, method, body, search: url.searchParams });

    if (url.pathname === '/auth/v1/user') return reply(session().user);
    if (url.pathname === '/auth/v1/logout') return reply({});
    if (url.pathname === '/auth/v1/token') {
      return this.signInError
        ? reply({ error: 'invalid_grant', error_description: this.signInError, msg: this.signInError }, 400)
        : reply(session());
    }
    if (url.pathname === '/auth/v1/signup') {
      return reply(this.signupRequiresConfirmation ? { ...session().user, identities: [] } : session());
    }
    if (url.pathname === '/functions/v1/analyze-sentiment') {
      if (this.analysisUnavailable) return reply({ error: 'Synthetic offline AI fixture' }, 503);
      const analysis = {
        id: this.id(), user_id: USER_ID, journal_entry_id: body.entryId,
        sentiment: 'positive', confidence: 0.8, summary: 'Synthetic test reflection.',
        keywords: ['hopeful'], source: 'ai', created_at: new Date().toISOString(),
      };
      this.rows.sentiment_analyses.unshift(analysis);
      return reply({ analysis });
    }
    if (url.pathname === '/rest/v1/rpc/get_shared_plan') return reply([]);
    const table = url.pathname.replace('/rest/v1/', '');
    if (!(table in this.rows)) {
      this.unexpected.push(`${method} ${url.pathname}`);
      return reply({ message: `No synthetic fixture for ${url.pathname}` }, 404);
    }
    // Mirror the real ownership column distinction, so export tests cannot
    // conceal invalid user_id filters on clinician tables.
    const invalidOwner = ['clients', 'soap_notes'].includes(table) ? 'user_id' : 'therapist_id';
    if (url.searchParams.has(invalidOwner)) {
      return reply({ code: '42703', message: `column ${table}.${invalidOwner} does not exist` }, 400);
    }
    if (method === 'GET' && this.unavailableTables.has(table)) {
      return reply({ code: 'XX000', message: 'Synthetic read unavailable' }, 500);
    }
    if (this.failNext?.table === table && this.failNext.method === method) {
      const message = this.failNext.message;
      this.failNext = null;
      return reply({ code: 'XX000', message }, 500);
    }
    const matches = (row: Row) => [...url.searchParams].every(([key, value]) => {
      if (value.startsWith('eq.')) return String(row[key]) === value.slice(3);
      return true;
    });
    if (method === 'GET') {
      let rows = this.rows[table].filter(matches);
      const offset = Number(url.searchParams.get('offset') || 0);
      const limit = Number(url.searchParams.get('limit'));
      rows = limit > 0 ? rows.slice(offset, offset + limit) : rows.slice(offset);
      if (request.headers()['accept']?.includes('vnd.pgrst.object')) return reply(rows[0] ?? null);
      return reply(rows);
    }
    if (method === 'POST') {
      const now = new Date().toISOString();
      const row = { id: this.id(), created_at: now, updated_at: now, ...body };
      const conflict = url.searchParams.get('on_conflict');
      if (conflict) this.rows[table] = this.rows[table].filter(item => item[conflict] !== row[conflict]);
      this.rows[table].unshift(row);
      return reply(request.headers()['accept']?.includes('vnd.pgrst.object') ? row : [row], 201);
    }
    if (method === 'PATCH') {
      this.rows[table] = this.rows[table].map(row => matches(row) ? { ...row, ...body } : row);
      return reply(this.rows[table].filter(matches));
    }
    if (method === 'DELETE') {
      this.rows[table] = this.rows[table].filter(row => !matches(row));
      return reply([]);
    }
    this.unexpected.push(`${method} ${url.pathname}`);
    return reply({ message: 'Unhandled synthetic request' }, 405);
  }

  private id() {
    return `22222222-2222-4222-8222-${String(this.sequence++).padStart(12, '0')}`;
  }
}

export const test = base.extend<{ api: MockSupabase }>({
  api: async ({ page }, use) => {
    const api = new MockSupabase(page);
    await use(api);
    expect(api.unexpected, 'Unexpected external requests / missing fixtures').toEqual([]);
    expect(api.errors, 'Uncaught application errors').toEqual([]);
  },
});
export { expect };
