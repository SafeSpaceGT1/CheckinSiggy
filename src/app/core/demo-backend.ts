import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { DEMO_AUTH_KEY, DEMO_DATA_KEY, DEMO_USER_ID } from "./demo-session";
import { DEMO_TABLES, seedDemoData, type DemoDatabase, type DemoRow, type DemoTable } from "./demo-data";
import { localSentiment } from "./sentiment-local";

// .invalid is reserved and cannot identify a real project. Every SDK HTTP request
// is handled below; unsupported routes fail locally and never call global fetch.
const ORIGIN = "https://siggy-demo.invalid";
const memory = new Map<string, string>();
const unavailableKeys = new Set<string>();
const storage = {
  getItem(key: string): string | null {
    if (unavailableKeys.has(key)) return memory.get(key) ?? null;
    try { return sessionStorage.getItem(key); }
    catch { return memory.get(key) ?? null; }
  },
  setItem(key: string, value: string): void {
    memory.set(key, value);
    try { sessionStorage.setItem(key, value); unavailableKeys.delete(key); }
    catch { unavailableKeys.add(key); }
  },
  removeItem(key: string): void {
    memory.delete(key);
    try { sessionStorage.removeItem(key); unavailableKeys.delete(key); }
    catch { unavailableKeys.add(key); }
  },
};

function session(): Session {
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return {
    access_token: `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: DEMO_USER_ID, exp: expires, role: "authenticated" })}.demo-only`,
    refresh_token: "demo-only-refresh-token", token_type: "bearer", expires_in: 3600, expires_at: expires,
    user: { id: DEMO_USER_ID, email: "alex.demo@example.invalid", aud: "authenticated", role: "authenticated",
      app_metadata: { provider: "email", providers: ["email"] }, user_metadata: { full_name: "Alex Demo" },
      created_at: "2026-01-01T00:00:00.000Z" },
  };
}

function readDatabase(): DemoDatabase {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(DEMO_DATA_KEY) ?? "null");
    if (parsed && typeof parsed === "object" && "version" in parsed && parsed.version === 1 && "rows" in parsed) {
      const rows = parsed.rows as DemoDatabase;
      if (rows && DEMO_TABLES.every((table) => Array.isArray(rows[table]))) return rows;
    }
  } catch { /* Invalid or unavailable demo storage starts a fresh fictional set. */ }
  const rows = seedDemoData();
  saveDatabase(rows);
  return rows;
}

function saveDatabase(rows: DemoDatabase): void {
  storage.setItem(DEMO_DATA_KEY, JSON.stringify({ version: 1, rows }));
}

const response = (body: unknown, status = 200, extra: Record<string, string> = {}) => new Response(
  status === 204 ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...extra } });
const failure = (message: string, status = 400, code = "DEMO_UNSUPPORTED") => response({ message, code }, status);
const ownerColumn = (table: DemoTable) => table === "clients" || table === "soap_notes" ? "therapist_id" : "user_id";
const isTable = (value: string): value is DemoTable => (DEMO_TABLES as readonly string[]).includes(value);

function defaults(table: DemoTable): DemoRow {
  switch (table) {
    case "mood_entries": return { notes: null, rating_10: null, tags: [], add_to_next_session: false };
    case "journal_entries": return { mood: null };
    case "sentiment_analyses": return { summary: null, keywords: [], source: "local" };
    case "wellness_goals": return { completed_dates: [], target_per_week: 3 };
    case "exercise_logs": return { notes: null, intensity: "moderate" };
    case "reminders": return { enabled: true, days_of_week: [0, 1, 2, 3, 4, 5, 6], kind: "mood_check" };
    case "crisis_plan_shares": return { revoked: false, expires_at: null };
    case "clients": return { email: null, phone: null };
    default: return {};
  }
}

function validRow(table: DemoTable, row: DemoRow, rows: DemoDatabase): boolean {
  if (row[ownerColumn(table)] !== DEMO_USER_ID) return false;
  if (table === "sentiment_analyses" && !rows.journal_entries.some((parent) => parent['id'] === row['journal_entry_id'])) return false;
  if (table === "soap_notes" && !rows.clients.some((parent) => parent['id'] === row['client_id'])) return false;
  if (table.startsWith("crisis_") && table !== "crisis_plans" && !rows.crisis_plans.some((parent) => parent['id'] === row['plan_id'])) return false;
  return true;
}

function deleteChildren(table: DemoTable, deleted: DemoRow[], rows: DemoDatabase): void {
  const ids = new Set(deleted.map((row) => row['id']));
  if (table === "journal_entries") rows.sentiment_analyses = rows.sentiment_analyses.filter((row) => !ids.has(row['journal_entry_id']));
  if (table === "clients") rows.soap_notes = rows.soap_notes.filter((row) => !ids.has(row['client_id']));
  if (table === "crisis_plans") {
    for (const child of DEMO_TABLES.filter((name) => name.startsWith("crisis_") && name !== table)) {
      rows[child] = rows[child].filter((row) => !ids.has(row['plan_id']));
    }
  }
}

function project(row: DemoRow, select: string | null): DemoRow {
  if (!select || select === "*") return row;
  return Object.fromEntries(select.split(",").map((key) => [key, row[key] ?? null]));
}

function insight(rows: DemoDatabase, rangeDays: number): DemoRow {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const start = new Date(`${today}T00:00:00.000Z`);
  start.setUTCDate(start.getUTCDate() - rangeDays + 1);
  const startKey = start.toISOString().slice(0, 10);
  const inRange = (row: DemoRow) => String(row['created_at']).slice(0, 10) >= startKey && String(row['created_at']).slice(0, 10) <= today;
  const moods = rows.mood_entries.filter(inRange);
  const journals = rows.journal_entries.filter(inRange).sort((a, b) => String(b['created_at']).localeCompare(String(a['created_at'])));
  const rating = (row: DemoRow) => Number(row['rating_10'] ?? row['value'] * 2);
  const numbers = moods.map(rating);
  const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const mean = average(numbers);
  const sorted = [...numbers].sort((a, b) => a - b);
  const median = sorted.length ? sorted.length % 2 ? sorted[Math.floor(sorted.length / 2)] :
    (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2 : null;
  const series = Array.from({ length: rangeDays }, (_, index) => {
    const date = new Date(start); date.setUTCDate(date.getUTCDate() + index);
    const key = date.toISOString().slice(0, 10);
    const dayMoods = moods.filter((row) => String(row['created_at']).startsWith(key));
    return { date: key, count: dayMoods.length, avg: average(dayMoods.map(rating)) };
  });
  const points = series.map((day, index) => ({ x: index, y: day.avg })).filter((point): point is { x: number; y: number } => point.y !== null);
  const xMean = average(points.map((point) => point.x)) ?? 0;
  const yMean = average(points.map((point) => point.y)) ?? 0;
  const denominator = points.reduce((sum, point) => sum + (point.x - xMean) ** 2, 0);
  const slope = denominator ? points.reduce((sum, point) => sum + (point.x - xMean) * (point.y - yMean), 0) / denominator : null;
  const priorStart = new Date(start); priorStart.setUTCDate(priorStart.getUTCDate() - rangeDays);
  const prior = rows.mood_entries.filter((row) => row['created_at'] >= priorStart.toISOString() && row['created_at'] < start.toISOString());
  const priorMean = average(prior.map(rating));
  const tags = new Map<string, number[]>();
  moods.forEach((row) => (row['tags'] as string[]).forEach((tag) => tags.set(tag, [...(tags.get(tag) ?? []), rating(row)])));
  const quotes = journals.slice(0, 3).map((row) => ({ id: row['id'], date: String(row['created_at']).slice(0, 10), text: String(row['content']).slice(0, 220) }));
  const concerns = moods.filter((row) => row['add_to_next_session']).map((row) => ({ source_id: row['id'],
    date: String(row['created_at']).slice(0, 10), reasons: ["flagged_for_session"], excerpt: String(row['notes'] ?? "Flagged check-in") }));
  const section = (text: string, ids: string[] = []) => ({ text: `Demo — ${text}`, source_ids: ids });
  return { generated_at: now.toISOString(), range_days: rangeDays, source: "local", demo: true,
    stats: { total_check_ins: moods.length, total_journals: journals.length, coverage_days: points.length, range_days: rangeDays,
      mean, median, stddev: mean === null ? null : Math.sqrt(numbers.reduce((sum, value) => sum + (value - mean) ** 2, 0) / numbers.length),
      slope, trend: slope === null ? null : slope > 0.05 ? "improving" : slope < -0.05 ? "declining" : "steady",
      delta_vs_prior: mean !== null && priorMean !== null ? mean - priorMean : null,
      top_tags: [...tags].map(([tag, values]) => ({ tag, count: values.length, avg: average(values) })).sort((a, b) => b.count - a.count).slice(0, 5), series },
    concerns, quotes,
    narrative: { data_coverage: section(`This local preview includes ${moods.length} check-ins and ${journals.length} journal entries across ${rangeDays} days.`),
      observed_patterns: section(mean === null ? "Add a check-in to populate the chart." : `The average mood rating in this preview is ${mean.toFixed(1)} out of 10.`),
      client_reported_concerns: section("This sample does not assess clinical concerns. Review any journal entry directly before drawing conclusions."),
      client_strengths: section("This is a sample reflection to demonstrate the report layout. No AI provider was contacted.", quotes.map((quote) => quote.id)),
      session_prompts: section("Sample prompt: What did you notice during your check-ins, and what would you like to explore next?") } };
}

/** An actual Supabase client with an entirely local, deliberately bounded transport. */
export function createDemoClient(): SupabaseClient {
  readDatabase();
  if (!storage.getItem(DEMO_AUTH_KEY)) storage.setItem(DEMO_AUTH_KEY, JSON.stringify(session()));
  // Supabase uses its storage key as a BroadcastChannel name. A unique client
  // key prevents demo sign-outs in one tab from changing another tab's session;
  // the adapter still persists this tab's session under the stable demo key.
  const authStorageKey = `${DEMO_AUTH_KEY}:${crypto.randomUUID()}`;

  const demoFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    if (request.signal.aborted) throw new DOMException("Aborted", "AbortError");
    const url = new URL(request.url);
    if (url.origin !== ORIGIN) return failure("Demo requests must remain local.", 403);
    const method = request.method;
    const body: DemoRow | DemoRow[] = method === "GET" || method === "HEAD" ? {} : await request.json().catch(() => ({}));
    const payload = Array.isArray(body) ? {} : body;
    const path = url.pathname;
    if (path === "/auth/v1/logout" && method === "POST") { storage.removeItem(DEMO_AUTH_KEY); return response({}); }
    if (path === "/auth/v1/token" && method === "POST") {
      if (url.searchParams.get("grant_type") !== "refresh_token" || payload['refresh_token'] !== "demo-only-refresh-token") return failure("Enter the demo with Explore demo.", 400);
      return response(session());
    }
    if (!storage.getItem(DEMO_AUTH_KEY)) return failure("The demo session has ended.", 401);
    if (path === "/auth/v1/user" && method === "GET") return response(session().user);
    const rows = readDatabase();
    if (path.startsWith("/functions/v1/") && method === "POST") {
      switch (path.slice("/functions/v1/".length)) {
        case "analyze-sentiment": {
          const entry = rows.journal_entries.find((row) => row['id'] === payload['entryId']);
          if (!entry) return failure("The demo entry was not found.", 404);
          const result = localSentiment(String(entry['content']));
          const existing = rows.sentiment_analyses.find((row) => row['journal_entry_id'] === entry['id']);
          const analysis = { id: existing?.['id'] ?? crypto.randomUUID(), user_id: DEMO_USER_ID, journal_entry_id: entry['id'],
            ...result, summary: `Demo reflection — ${result.summary}`, source: "local", created_at: new Date().toISOString() };
          rows.sentiment_analyses = [...rows.sentiment_analyses.filter((row) => row['journal_entry_id'] !== entry['id']), analysis];
          saveDatabase(rows); return response({ analysis, source: "local", demo: true });
        }
        case "analyze-journal-history": {
          const limit = Math.max(1, Math.min(100, Number(payload['limit']) || 30));
          const entries = [...rows.journal_entries].sort((a, b) => String(b['created_at']).localeCompare(String(a['created_at']))).slice(0, limit);
          if (!entries.length) return response({ empty: true, source: "local", demo: true });
          const result = localSentiment(entries.map((row) => row['content']).join("\n"));
          return response({ source: "local", demo: true, analysis: {
            overall: `Demo reflection — a simple local word count across ${entries.length} entries leans ${result.sentiment}.`,
            themes: result.keywords, observations: ["This preview uses an on-device word count; no AI provider was contacted."],
            encouragement: "Sample prompt: Which entry would you like to explore further?",
          } });
        }
        case "siggy-insight": {
          const range = Number(payload['rangeDays'] ?? 30);
          return [7, 30, 90].includes(range) ? response(insight(rows, range)) : failure("Choose 7, 30 or 90 days.");
        }
        case "delete-account":
          saveDatabase(Object.fromEntries(DEMO_TABLES.map((table) => [table, [] as DemoRow[]])) as DemoDatabase);
          storage.removeItem(DEMO_AUTH_KEY);
          return response({ deleted: true, demo: true });
      }
    }
    if (path === "/rest/v1/rpc/get_shared_plan" && method === "POST") {
      const share = rows.crisis_plan_shares.find((row) => row['token'] === payload['share_token'] && !row['revoked'] &&
        (!row['expires_at'] || Date.parse(row['expires_at']) > Date.now()));
      if (!share) return response(null);
      const sections = ["warning_signs", "coping_strategies", "distractions", "support_contacts", "professional_contacts", "safety_steps", "reasons_for_living"];
      return response(Object.fromEntries(sections.map((section) => [section, rows[`crisis_${section}` as DemoTable]
        .filter((row) => row['plan_id'] === share['plan_id']).sort((a, b) => a['position'] - b['position'])])));
    }
    if (path === "/rest/v1/rpc/toggle_wellness_goal_today" && method === "POST") {
      const goal = rows.wellness_goals.find((row) => row['id'] === payload['goal_id']);
      if (!goal) return failure("The demo goal was not found.", 404);
      const date = String(payload['completion_date']);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return failure("Choose a valid date.");
      const dates = goal['completed_dates'] as string[];
      goal['completed_dates'] = dates.includes(date) ? dates.filter((item) => item !== date) : [...dates, date].sort();
      goal['updated_at'] = new Date().toISOString();
      saveDatabase(rows); return response(goal);
    }
    const name = path.startsWith("/rest/v1/") ? path.slice("/rest/v1/".length) : "";
    if (!isTable(name)) return failure("This operation is not available in the demo.", 404);
    if (!["GET", "HEAD", "POST", "PATCH", "DELETE"].includes(method)) return failure("This demo method is not supported.", 405);
    const params = url.searchParams;
    const controls = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);
    const filters = [...params].filter(([key]) => !controls.has(key));
    if (filters.some(([key, value]) => !/^[a-z_][a-z0-9_]*$/.test(key) || !/^(eq|neq|gte|lte|gt|lt|is)\./.test(value))) return failure("Unsupported demo filter.");
    const matches = (row: DemoRow) => row[ownerColumn(name)] === DEMO_USER_ID && filters.every(([key, value]) => {
      const dot = value.indexOf("."); const operator = value.slice(0, dot); const expected = value.slice(dot + 1);
      const actual = String(row[key]);
      switch (operator) {
        case "eq": return actual === expected;
        case "neq": return actual !== expected;
        case "gte": return actual >= expected;
        case "lte": return actual <= expected;
        case "gt": return actual > expected;
        case "lt": return actual < expected;
        case "is": return expected === "null" ? row[key] == null : actual === expected;
        default: return false;
      }
    });
    const select = params.get("select");
    if (select && select !== "*" && !select.split(",").every((key) => /^[a-z_][a-z0-9_]*$/.test(key))) return failure("Unsupported demo projection.");
    let selected = rows[name].filter(matches);
    if (method === "POST" || method === "PATCH") {
      const now = new Date().toISOString();
      const conflict = params.get("on_conflict");
      if (conflict && !["id", "user_id", "journal_entry_id"].includes(conflict)) return failure("Unsupported demo conflict key.");
      let changes: DemoRow[];
      if (method === "POST") {
        changes = (Array.isArray(body) ? body : [body]).map((values) => {
          const old = conflict ? rows[name].find((row) => row[conflict] === values[conflict]) : undefined;
          return { id: crypto.randomUUID(), created_at: now, updated_at: now, ...defaults(name), ...old, ...values };
        });
      } else changes = selected.map((row) => ({ ...row, ...payload, updated_at: now }));
      if (changes.some((row) => !validRow(name, row, rows))) return failure("This demo row must belong to the fictional account and an existing parent.", 403);
      const changedIds = new Set(changes.map((row) => row['id']));
      rows[name] = [...rows[name].filter((row) => !changedIds.has(row['id'])), ...changes];
      selected = changes; saveDatabase(rows);
    } else if (method === "DELETE") {
      rows[name] = rows[name].filter((row) => !matches(row)); deleteChildren(name, selected, rows); saveDatabase(rows);
    }
    const total = selected.length;
    const order = params.get("order");
    if (order) {
      const parts = order.split(",").map((value) => value.split("."));
      selected.sort((a, b) => {
        for (const [key, direction] of parts) {
          const result = a[key] === b[key] ? 0 : a[key] == null ? 1 : b[key] == null ? -1 : a[key] < b[key] ? -1 : 1;
          if (result) return direction === "desc" ? -result : result;
        }
        return 0;
      });
    }
    const offset = Math.max(0, Number(params.get("offset")) || 0);
    const limit = params.has("limit") ? Math.max(0, Number(params.get("limit")) || 0) : selected.length;
    selected = selected.slice(offset, offset + limit).map((row) => project(row, select));
    if (request.headers.get("accept")?.includes("vnd.pgrst.object")) {
      if (selected.length !== 1) return response({ code: "PGRST116", message: "A single demo row was expected.", details: `The result contains ${selected.length} rows` }, 406);
      return response(selected[0], method === "POST" ? 201 : 200);
    }
    return response(method === "HEAD" ? null : selected, method === "POST" ? 201 : 200,
      { "Content-Range": `${offset}-${Math.max(offset, offset + selected.length - 1)}/${total}` });
  };

  return createClient(ORIGIN, "demo-publishable-key-no-real-project", {
    global: { fetch: demoFetch },
    auth: { storageKey: authStorageKey, storage: {
      getItem: (key) => key === authStorageKey ? storage.getItem(DEMO_AUTH_KEY) : null,
      setItem: (key, value) => { if (key === authStorageKey) storage.setItem(DEMO_AUTH_KEY, value); },
      removeItem: (key) => { if (key === authStorageKey) storage.removeItem(DEMO_AUTH_KEY); },
    }, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false,
      lock: async (_name, _timeout, task) => task() },
  });
}
