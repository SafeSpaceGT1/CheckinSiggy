import type { SupabaseClient } from "@supabase/supabase-js";
import { createDemoClient } from "./demo-backend";
import { DEMO_AUTH_KEY, DEMO_DATA_KEY, DEMO_USER_ID } from "./demo-session";

describe("isolated interactive demo backend", () => {
  let client: SupabaseClient;
  const clients: SupabaseClient[] = [];
  let fetchSpy: jasmine.Spy;
  const newClient = () => { const value = createDemoClient(); clients.push(value); return value; };
  beforeEach(async () => {
    sessionStorage.removeItem(DEMO_DATA_KEY);
    sessionStorage.removeItem(DEMO_AUTH_KEY);
    fetchSpy = spyOn(window, "fetch").and.rejectWith(new Error("A demo must never use the network"));
    client = newClient();
    await client.auth.getSession();
  });
  afterEach(async () => {
    for (const value of clients.splice(0)) await value.auth.signOut({ scope: "local" });
    sessionStorage.removeItem(DEMO_DATA_KEY);
    sessionStorage.removeItem(DEMO_AUTH_KEY);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("starts with a synthetic session and dated sample rows without touching live authentication", async () => {
    localStorage.setItem("siggy-demo-test-live-account", "untouched-live-session");
    try {
      const result = await client.auth.getSession();
      expect(result.data.session?.user.id).toBe(DEMO_USER_ID);
      expect(result.data.session?.user.email).toBe("alex.demo@example.invalid");
      const moods = await client.from("mood_entries").select("id,value,rating_10,created_at").order("created_at", { ascending: false }).range(0, 4);
      expect(moods.error).toBeNull();
      expect(moods.data?.length).toBe(5);
      expect(moods.data?.[0].created_at.slice(0, 10)).toBe(new Date().toISOString().slice(0, 10));
      await client.auth.signOut();
      expect((await client.auth.getSession()).data.session).toBeNull();
      expect(localStorage.getItem("siggy-demo-test-live-account")).toBe("untouched-live-session");
    } finally { localStorage.removeItem("siggy-demo-test-live-account"); }
  });

  it("persists creates, applies filters and defaults, updates and deletes through the real SDK", async () => {
    const inserted = await client.from("reminders").insert({ user_id: DEMO_USER_ID,
      title: "Demo test reminder", time_of_day: "17:00", days_of_week: [1, 3], kind: "custom" }).select("id,title,enabled").single();
    expect(inserted.error).toBeNull();
    expect(inserted.data?.enabled).toBeTrue();
    const restored = newClient();
    await restored.auth.getSession();
    const changed = await restored.from("reminders").update({ enabled: false }).eq("id", inserted.data!.id).eq("user_id", DEMO_USER_ID).select("id,enabled").single();
    expect(changed.error).toBeNull();
    expect(changed.data?.enabled).toBeFalse();
    const removed = await restored.from("reminders").delete().eq("id", inserted.data!.id).select("id").single();
    expect(removed.data?.id).toBe(inserted.data!.id);
    const missing = await restored.from("reminders").select("id").eq("id", inserted.data!.id).maybeSingle();
    expect(missing.error).toBeNull();
    expect(missing.data).toBeNull();
  });

  it("rejects foreign ownership, broken parent references and unknown operations locally", async () => {
    expect((await client.from("mood_entries").insert({ user_id: "another-account", value: 5 })).error).not.toBeNull();
    expect((await client.from("soap_notes").insert({ therapist_id: DEMO_USER_ID, client_id: "missing-client" })).error).not.toBeNull();
    expect((await client.from("unknown_table").select()).error).not.toBeNull();
    expect((await client.rpc("unknown_rpc", {})).error).not.toBeNull();
    expect((await client.functions.invoke("unknown-function", { body: {} })).error).not.toBeNull();
    expect((await client.auth.signInWithPassword({ email: "real-person@example.invalid", password: "demo-test-value" })).error).not.toBeNull();
    expect((await client.from("mood_entries").select().eq("user_id", "another-account")).data).toEqual([]);
  });

  it("creates coherent local reflections and cascades deletion of journal analyses", async () => {
    const entry = await client.from("journal_entries").insert({ user_id: DEMO_USER_ID, content: "I am grateful and hopeful." }).select("id").single();
    const analysis = await client.functions.invoke("analyze-sentiment", { body: { entryId: entry.data!.id } });
    expect(analysis.error).toBeNull();
    expect(analysis.data.source).toBe("local");
    expect(analysis.data.analysis.source).toBe("local");
    expect(analysis.data.analysis.sentiment).toBe("positive");
    expect(analysis.data.analysis.summary).toContain("Demo reflection");
    await client.functions.invoke("analyze-sentiment", { body: { entryId: entry.data!.id } });
    expect((await client.from("sentiment_analyses").select().eq("journal_entry_id", entry.data!.id)).data?.length).toBe(1);
    await client.from("journal_entries").delete().eq("id", entry.data!.id);
    expect((await client.from("sentiment_analyses").select().eq("journal_entry_id", entry.data!.id)).data).toEqual([]);
  });

  it("updates local insight statistics after edits and labels both report functions as demos", async () => {
    const before = await client.functions.invoke("siggy-insight", { body: { rangeDays: 7 } });
    expect(before.error).toBeNull();
    expect(before.data.stats.mean).toBeGreaterThan(5);
    expect(before.data.quotes[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(before.data.concerns[0].reasons).toContain("flagged_for_session");
    await client.from("mood_entries").insert({ user_id: DEMO_USER_ID, value: 5, rating_10: 9, emoji: "😄" });
    const after = await client.functions.invoke("siggy-insight", { body: { rangeDays: 7 } });
    expect(after.data.stats.total_check_ins).toBe(before.data.stats.total_check_ins + 1);
    expect(after.data.stats.mean).toBeCloseTo((before.data.stats.mean * before.data.stats.total_check_ins + 9) / after.data.stats.total_check_ins);
    expect(after.data.stats.series.length).toBe(7);
    expect(after.data.demo).toBeTrue();
    expect(after.data.narrative.client_strengths.text).toContain("No AI provider was contacted");
    const history = await client.functions.invoke("analyze-journal-history", { body: { limit: 3 } });
    expect(history.data.source).toBe("local");
    expect(history.data.analysis.overall).toContain("3 entries");
  });

  it("toggles goal completion from stored state and respects local share revocation", async () => {
    const goal = await client.from("wellness_goals").select().limit(1).single();
    const date = "2026-01-15";
    const first = await client.rpc("toggle_wellness_goal_today", { goal_id: goal.data!.id, completion_date: date });
    expect(first.data.completed_dates).toContain(date);
    const second = await client.rpc("toggle_wellness_goal_today", { goal_id: goal.data!.id, completion_date: date });
    expect(second.data.completed_dates).not.toContain(date);
    const plan = await client.from("crisis_plans").select("id").single();
    const share = await client.from("crisis_plan_shares").insert({ user_id: DEMO_USER_ID, plan_id: plan.data!.id, token: "local-demo-share" }).select("id").single();
    const shared = await client.rpc("get_shared_plan", { share_token: "local-demo-share" });
    expect(shared.data.warning_signs.length).toBeGreaterThan(0);
    await client.from("crisis_plan_shares").update({ revoked: true }).eq("id", share.data!.id);
    expect((await client.rpc("get_shared_plan", { share_token: "local-demo-share" })).data).toBeNull();
  });

  it("restarts sample data when the demo data key is reset", async () => {
    await client.from("clients").delete().eq("therapist_id", DEMO_USER_ID);
    expect((await client.from("soap_notes").select()).data).toEqual([]);
    sessionStorage.removeItem(DEMO_DATA_KEY);
    const restarted = newClient();
    expect((await restarted.from("clients").select()).data?.length).toBe(3);
    expect((await restarted.from("soap_notes").select()).data?.length).toBe(2);
  });

  it("deletes only the local demo account with the settings page response contract", async () => {
    const result = await client.functions.invoke("delete-account", { body: {} });
    expect(result.error).toBeNull();
    expect(result.data).toEqual({ deleted: true, demo: true });
    expect(sessionStorage.getItem(DEMO_AUTH_KEY)).toBeNull();
    const stored = JSON.parse(sessionStorage.getItem(DEMO_DATA_KEY)!);
    expect(Object.values(stored.rows).every((rows) => Array.isArray(rows) && rows.length === 0)).toBeTrue();
    expect((await client.from("mood_entries").select()).error).not.toBeNull();
  });
});
