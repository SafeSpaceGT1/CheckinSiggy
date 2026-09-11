import type { SupabaseClient } from "@supabase/supabase-js";
import { createDemoClient } from "./demo-backend";
import { DEMO_AUTH_KEY, DEMO_DATA_KEY, DEMO_USER_ID } from "./demo-session";
import type { TherapyConnection, TherapySession } from "./therapy.types";

describe("isolated interactive demo backend", () => {
  let client: SupabaseClient;
  const clients: SupabaseClient[] = [];
  const roleKey = "siggy:demo:role";
  const hour = 60 * 60 * 1000;
  const future = (hours: number) => new Date(Date.now() + hours * hour).toISOString();
  let fetchSpy: jasmine.Spy;
  const newClient = () => { const value = createDemoClient(); clients.push(value); return value; };
  const connected = async () => {
    const result = await client.from("therapy_connections").select().eq("user_id", DEMO_USER_ID).is("revoked_at", null).single();
    expect(result.error).toBeNull();
    return result.data as TherapyConnection;
  };
  const schedule = async (connectionId: string, hours = 12) => {
    const result = await client.rpc("save_therapy_session", {
      p_connection_id: connectionId, p_starts_at: future(hours), p_duration_minutes: 50, p_session_id: null,
    });
    expect(result.error).toBeNull();
    return result.data as TherapySession;
  };
  beforeEach(async () => {
    sessionStorage.removeItem(DEMO_DATA_KEY);
    sessionStorage.removeItem(DEMO_AUTH_KEY);
    sessionStorage.removeItem(roleKey);
    fetchSpy = spyOn(window, "fetch").and.rejectWith(new Error("A demo must never use the network"));
    client = newClient();
    await client.auth.getSession();
  });
  afterEach(async () => {
    for (const value of clients.splice(0)) await value.auth.signOut({ scope: "local" });
    sessionStorage.removeItem(DEMO_DATA_KEY);
    sessionStorage.removeItem(DEMO_AUTH_KEY);
    sessionStorage.removeItem(roleKey);
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

  it("seeds a connected therapist, future sessions and a reviewed note on a past session", async () => {
    const connection = await connected();
    const firstClient = await client.from("clients").select().order("created_at").limit(1).single();
    expect(connection.client_id).toBe(firstClient.data!.id);
    expect(connection.therapist_id).toBe(DEMO_USER_ID);
    expect(connection.therapist_name).toBe("Dr. Taylor Morgan (demo)");
    const result = await client.from("therapy_sessions").select().eq("connection_id", connection.id).order("starts_at");
    expect(result.error).toBeNull();
    const sessions = result.data as TherapySession[];
    const upcoming = sessions.filter((session) => Date.parse(session.starts_at) > Date.now());
    const localDay = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    const expectedDays = [2, 5].map((offset) => {
      const date = new Date(); date.setDate(date.getDate() + offset); return localDay(date);
    });
    expect(upcoming.map((session) => localDay(new Date(session.starts_at)))).toEqual(expectedDays);
    expect(sessions.every((session) => session.user_id === DEMO_USER_ID && session.therapist_id === DEMO_USER_ID)).toBeTrue();
    const notes = await client.from("pre_session_notes").select();
    const reviewed = notes.data?.find((note) => note.status === "submitted" && note.reviewed_at);
    expect(reviewed).toBeDefined();
    expect(reviewed!.submitted_at).not.toBeNull();
    const past = sessions.find((session) => session.id === reviewed!.session_id);
    expect(past).toBeDefined();
    expect(Date.parse(past!.starts_at)).toBeLessThan(Date.now());
  });

  it("creates, previews, reissues and accepts seven-day invites through the SDK", async () => {
    const existing = await connected();
    const otherClient = await client.from("clients").select().neq("id", existing.client_id).limit(1).single();
    const started = Date.now();
    const invite = await client.rpc("create_therapy_invite", {
      p_client_id: otherClient.data!.id, p_therapist_name: "Dr. Sam Demo",
    });
    expect(invite.error).toBeNull();
    expect(Array.isArray(invite.data)).toBeFalse();
    expect(invite.data.connection.user_id).toBeNull();
    expect(invite.data.connection.client_id).toBe(otherClient.data!.id);
    expect(invite.data.token).toEqual(jasmine.any(String));
    expect(Date.parse(invite.data.expires_at)).toBeGreaterThanOrEqual(started + 7 * 24 * hour);
    expect(Date.parse(invite.data.expires_at)).toBeLessThanOrEqual(Date.now() + 7 * 24 * hour);
    const preview = await client.rpc("preview_therapy_invite", { p_token: invite.data.token });
    expect(preview.error).toBeNull();
    expect(preview.data).toEqual({ therapist_name: "Dr. Sam Demo", expires_at: invite.data.expires_at });
    expect((await client.rpc("save_therapy_session", {
      p_connection_id: invite.data.connection.id, p_starts_at: future(12), p_duration_minutes: 50, p_session_id: null,
    })).error).not.toBeNull();

    const reissued = await client.rpc("create_therapy_invite", {
      p_client_id: otherClient.data!.id, p_therapist_name: "Dr. Sam Demo",
    });
    expect(reissued.error).toBeNull();
    expect(reissued.data.connection.id).toBe(invite.data.connection.id);
    expect(reissued.data.token).not.toBe(invite.data.token);
    expect((await client.rpc("accept_therapy_invite", { p_token: invite.data.token })).error).not.toBeNull();
    const accepted = await client.rpc("accept_therapy_invite", { p_token: reissued.data.token });
    expect(accepted.error).toBeNull();
    expect(accepted.data.id).toBe(invite.data.connection.id);
    expect(accepted.data.user_id).toBe(DEMO_USER_ID);
    expect(accepted.data.revoked_at).toBeNull();
    expect((await client.rpc("create_therapy_invite", {
      p_client_id: otherClient.data!.id, p_therapist_name: "Dr. Sam Demo",
    })).error).not.toBeNull();
    expect((await client.rpc("preview_therapy_invite", { p_token: "missing-invite" })).error).not.toBeNull();
    expect((await client.rpc("accept_therapy_invite", { p_token: "missing-invite" })).error).not.toBeNull();
    expect((await client.rpc("create_therapy_invite", {
      p_client_id: "missing-client", p_therapist_name: "Dr. Sam Demo",
    })).error).not.toBeNull();
  });

  it("persists scheduled sessions and reschedules the same row with validated input", async () => {
    const connection = await connected();
    const session = await schedule(connection.id);
    const startsAt = future(36);
    const changed = await client.rpc("save_therapy_session", {
      p_connection_id: connection.id, p_starts_at: startsAt, p_duration_minutes: 75, p_session_id: session.id,
    });
    expect(changed.error).toBeNull();
    expect(changed.data).toEqual(jasmine.objectContaining({
      id: session.id, connection_id: connection.id, starts_at: startsAt, duration_minutes: 75,
      status: "scheduled", user_id: DEMO_USER_ID, therapist_id: DEMO_USER_ID,
    }));
    const restored = newClient();
    const saved = await restored.from("therapy_sessions").select().eq("id", session.id).single();
    expect(saved.error).toBeNull();
    expect(saved.data).toEqual(changed.data);
    for (const input of [
      { p_starts_at: "invalid-date" },
      { p_starts_at: new Date(Date.now() - hour).toISOString() },
      { p_starts_at: future(367 * 24) },
      { p_duration_minutes: 14 }, { p_duration_minutes: 181 }, { p_duration_minutes: 45.5 },
      { p_connection_id: "missing-connection" }, { p_session_id: "missing-session" },
    ]) {
      const invalid = await client.rpc("save_therapy_session", {
        p_connection_id: connection.id, p_starts_at: future(24), p_duration_minutes: 50, p_session_id: session.id, ...input,
      });
      expect(invalid.error).withContext(JSON.stringify(input)).not.toBeNull();
    }
    expect((await client.from("therapy_sessions").select().eq("id", session.id).single()).data).toEqual(changed.data);
  });

  it("keeps draft notes private, shares on submission and clears review when a shared note changes", async () => {
    const session = await schedule((await connected()).id);
    const draft = await client.rpc("save_pre_session_note", {
      p_session_id: session.id, p_body: "  I want to discuss my sleep.  ", p_submit: false,
    });
    expect(draft.error).toBeNull();
    expect(draft.data).toEqual(jasmine.objectContaining({
      session_id: session.id, user_id: DEMO_USER_ID, body: "I want to discuss my sleep.",
      status: "draft", submitted_at: null, reviewed_at: null,
    }));
    expect((await client.from("pre_session_notes").select().eq("session_id", session.id).single()).data).toEqual(draft.data);
    sessionStorage.setItem(roleKey, "clinician");
    const hidden = await client.from("pre_session_notes").select("session_id,body", { count: "exact" }).eq("session_id", session.id);
    expect(hidden.error).toBeNull();
    expect(hidden.data).toEqual([]);
    expect(hidden.count).toBe(0);
    expect((await client.rpc("mark_pre_session_note_reviewed", {
      p_session_id: session.id, p_expected_updated_at: draft.data.updated_at,
    })).error).not.toBeNull();

    sessionStorage.setItem(roleKey, "client");
    const submitted = await client.rpc("save_pre_session_note", {
      p_session_id: session.id, p_body: "I want to discuss my sleep.", p_submit: true,
      p_expected_updated_at: draft.data.updated_at,
    });
    expect(submitted.error).toBeNull();
    expect(submitted.data.status).toBe("submitted");
    expect(submitted.data.submitted_at).toEqual(jasmine.any(String));
    sessionStorage.setItem(roleKey, "clinician");
    const shared = await client.from("pre_session_notes").select().eq("session_id", session.id).single();
    expect(shared.error).toBeNull();
    expect(shared.data).toEqual(submitted.data);
    const reviewed = await client.rpc("mark_pre_session_note_reviewed", {
      p_session_id: session.id, p_expected_updated_at: submitted.data.updated_at,
    });
    expect(reviewed.error).toBeNull();
    expect(reviewed.data.reviewed_at).toEqual(jasmine.any(String));

    sessionStorage.setItem(roleKey, "client");
    const changed = await client.rpc("save_pre_session_note", {
      p_session_id: session.id, p_body: "I also want to discuss work stress.", p_submit: true,
      p_expected_updated_at: reviewed.data.updated_at,
    });
    expect(changed.error).toBeNull();
    expect(changed.data.status).toBe("submitted");
    expect(changed.data.reviewed_at).toBeNull();
    expect((await client.from("pre_session_notes").select().eq("session_id", session.id)).data).toEqual([changed.data]);
  });

  it("rejects stale client saves and missing existing-note revisions without overwriting the saved note", async () => {
    const session = await schedule((await connected()).id);
    const original = await client.rpc("save_pre_session_note", {
      p_session_id: session.id, p_body: "My first draft.", p_submit: false, p_expected_updated_at: null,
    });
    expect(original.error).toBeNull();
    const anotherEditor = newClient();
    const newer = await anotherEditor.rpc("save_pre_session_note", {
      p_session_id: session.id, p_body: "A newer draft from another editor.", p_submit: false,
      p_expected_updated_at: original.data.updated_at,
    });
    expect(newer.error).toBeNull();
    const expectedError = "This note changed. Reload the saved note before editing.";
    for (const revision of [
      { p_expected_updated_at: original.data.updated_at },
      { p_expected_updated_at: null },
      {},
    ]) {
      const stale = await client.rpc("save_pre_session_note", {
        p_session_id: session.id, p_body: "An older editor would overwrite the newer draft.", p_submit: true,
        ...revision,
      });
      expect(stale.error?.message).withContext(JSON.stringify(revision)).toBe(expectedError);
      expect(stale.error?.code).toBe("40001");
      expect((await client.from("pre_session_notes").select().eq("session_id", session.id).single()).data).toEqual(newer.data);
    }
  });

  it("reviews only the therapist's exact snapshot and preserves review metadata against a stale client save", async () => {
    const session = await schedule((await connected()).id);
    const original = await client.rpc("save_pre_session_note", {
      p_session_id: session.id, p_body: "The first shared note.", p_submit: true, p_expected_updated_at: null,
    });
    expect(original.error).toBeNull();
    sessionStorage.setItem(roleKey, "clinician");
    const therapistSnapshot = await client.from("pre_session_notes").select().eq("session_id", session.id).single();
    expect(therapistSnapshot.error).toBeNull();
    sessionStorage.setItem(roleKey, "client");
    const updated = await client.rpc("save_pre_session_note", {
      p_session_id: session.id, p_body: "A new topic the therapist has not read.", p_submit: true,
      p_expected_updated_at: original.data.updated_at,
    });
    expect(updated.error).toBeNull();
    sessionStorage.setItem(roleKey, "clinician");
    const staleReview = await client.rpc("mark_pre_session_note_reviewed", {
      p_session_id: session.id, p_expected_updated_at: therapistSnapshot.data!.updated_at,
    });
    expect(staleReview.error?.message).toBe("This note changed. Reload the saved note before editing.");
    const current = await client.from("pre_session_notes").select().eq("session_id", session.id).single();
    expect(current.data).toEqual(updated.data);
    expect(current.data!.reviewed_at).toBeNull();
    const reviewed = await client.rpc("mark_pre_session_note_reviewed", {
      p_session_id: session.id, p_expected_updated_at: current.data!.updated_at,
    });
    expect(reviewed.error).toBeNull();
    expect(reviewed.data.reviewed_at).toEqual(jasmine.any(String));
    sessionStorage.setItem(roleKey, "client");
    const staleSave = await client.rpc("save_pre_session_note", {
      p_session_id: session.id, p_body: "An edit based on the note before it was reviewed.", p_submit: true,
      p_expected_updated_at: updated.data.updated_at,
    });
    expect(staleSave.error?.message).toBe("This note changed. Reload the saved note before editing.");
    expect((await client.from("pre_session_notes").select().eq("session_id", session.id).single()).data).toEqual(reviewed.data);
  });

  it("advances note revisions and action timestamps for saves and reviews in the same millisecond", async () => {
    const session = await schedule((await connected()).id);
    const now = Date.now();
    spyOn(Date, "now").and.returnValue(now);
    const original = await client.rpc("save_pre_session_note", {
      p_session_id: session.id, p_body: "First shared version.", p_submit: true, p_expected_updated_at: null,
    });
    expect(original.error).toBeNull();
    expect(original.data.updated_at).toBe(new Date(now).toISOString());
    expect(original.data.submitted_at).toBe(original.data.updated_at);
    const updated = await client.rpc("save_pre_session_note", {
      p_session_id: session.id, p_body: "Second shared version.", p_submit: true,
      p_expected_updated_at: original.data.updated_at,
    });
    expect(updated.error).toBeNull();
    expect(updated.data.updated_at).toBe(new Date(now + 1).toISOString());
    expect(updated.data.submitted_at).toBe(updated.data.updated_at);
    sessionStorage.setItem(roleKey, "clinician");
    const reviewed = await client.rpc("mark_pre_session_note_reviewed", {
      p_session_id: session.id, p_expected_updated_at: updated.data.updated_at,
    });
    expect(reviewed.error).toBeNull();
    expect(reviewed.data.updated_at).toBe(new Date(now + 2).toISOString());
    expect(reviewed.data.reviewed_at).toBe(reviewed.data.updated_at);
    expect(reviewed.data.submitted_at).toBe(updated.data.submitted_at);
    sessionStorage.setItem(roleKey, "client");
    const editedAfterReview = await client.rpc("save_pre_session_note", {
      p_session_id: session.id, p_body: "Third shared version.", p_submit: true,
      p_expected_updated_at: reviewed.data.updated_at,
    });
    expect(editedAfterReview.error).toBeNull();
    expect(editedAfterReview.data.updated_at).toBe(new Date(now + 3).toISOString());
    expect(editedAfterReview.data.submitted_at).toBe(editedAfterReview.data.updated_at);
    expect(editedAfterReview.data.reviewed_at).toBeNull();
  });

  it("rejects invalid notes and prevents editing or reviewing cancelled and missing sessions", async () => {
    const session = await schedule((await connected()).id);
    for (const body of ["   ", "x".repeat(2001)]) {
      expect((await client.rpc("save_pre_session_note", {
        p_session_id: session.id, p_body: body, p_submit: false,
      })).error).not.toBeNull();
    }
    const cancelled = await client.rpc("cancel_therapy_session", { p_session_id: session.id });
    expect(cancelled.error).toBeNull();
    expect(cancelled.data.id).toBe(session.id);
    expect(cancelled.data.status).toBe("cancelled");
    expect((await client.rpc("save_therapy_session", {
      p_connection_id: session.connection_id, p_starts_at: future(24), p_duration_minutes: 50, p_session_id: session.id,
    })).error).not.toBeNull();
    for (const sessionId of [session.id, "missing-session"]) {
      expect((await client.rpc("save_pre_session_note", {
        p_session_id: sessionId, p_body: "A valid note.", p_submit: true,
      })).error).not.toBeNull();
      expect((await client.rpc("mark_pre_session_note_reviewed", {
        p_session_id: sessionId, p_expected_updated_at: new Date().toISOString(),
      })).error).not.toBeNull();
    }
    expect((await client.rpc("cancel_therapy_session", { p_session_id: "missing-session" })).error).not.toBeNull();
    expect((await client.from("pre_session_notes").select().eq("session_id", session.id)).data).toEqual([]);
  });

  it("revokes a connection, cancels its future sessions and rejects reconnecting or further scheduling", async () => {
    const connection = await connected();
    const before = await client.from("therapy_sessions").select().eq("connection_id", connection.id);
    const revoked = await client.rpc("revoke_therapy_connection", { p_connection_id: connection.id });
    expect(revoked.error).toBeNull();
    expect(revoked.data.id).toBe(connection.id);
    expect(revoked.data.revoked_at).toEqual(jasmine.any(String));
    const after = await client.from("therapy_sessions").select().eq("connection_id", connection.id);
    for (const session of before.data as TherapySession[]) {
      const saved = after.data!.find((row) => row.id === session.id);
      expect(saved?.status).toBe(Date.parse(session.starts_at) > Date.now() ? "cancelled" : session.status);
    }
    expect((await client.rpc("save_therapy_session", {
      p_connection_id: connection.id, p_starts_at: future(24), p_duration_minutes: 50, p_session_id: null,
    })).error).not.toBeNull();
    expect((await client.rpc("create_therapy_invite", {
      p_client_id: connection.client_id, p_therapist_name: connection.therapist_name,
    })).error).not.toBeNull();
    expect((await client.rpc("revoke_therapy_connection", { p_connection_id: "missing-connection" })).error).not.toBeNull();
  });

  it("permits therapy writes only through the validated RPCs", async () => {
    const connection = await connected();
    const session = await schedule(connection.id);
    const records: { table: string; key: string; row: Record<string, unknown> }[] = [
      { table: "therapy_connections", key: "id", row: { ...connection } },
      { table: "therapy_sessions", key: "id", row: { ...session } },
      { table: "pre_session_notes", key: "session_id", row: {
        session_id: session.id, user_id: DEMO_USER_ID, body: "Direct write", status: "submitted",
      } },
    ];
    for (const { table, key, row } of records) {
      const id = row[key];
      expect((await client.from(table).insert(row)).error).withContext(`${table} insert`).not.toBeNull();
      expect((await client.from(table).update(row).eq(key, id)).error).withContext(`${table} update`).not.toBeNull();
      expect((await client.from(table).delete().eq(key, id)).error).withContext(`${table} delete`).not.toBeNull();
    }
    expect((await client.from("therapy_connections").select().eq("id", connection.id).single()).data).toEqual(connection);
    expect((await client.from("therapy_sessions").select().eq("id", session.id).single()).data).toEqual(session);
    expect((await client.from("pre_session_notes").select().eq("session_id", session.id)).data).toEqual([]);
  });

  it("migrates old v1 demo state without replacing existing rows", async () => {
    const created = await client.from("reminders").insert({ user_id: DEMO_USER_ID,
      title: "Keep my custom demo reminder", time_of_day: "16:00", days_of_week: [2] }).select().single();
    expect(created.error).toBeNull();
    const stored = JSON.parse(sessionStorage.getItem(DEMO_DATA_KEY)!);
    const previousClients = stored.rows.clients;
    const previousReminders = stored.rows.reminders;
    for (const table of Object.keys(stored.rows)) {
      if (table.startsWith("therapy_") || table === "pre_session_notes") delete stored.rows[table];
    }
    sessionStorage.setItem(DEMO_DATA_KEY, JSON.stringify(stored));
    const restored = newClient();
    expect((await restored.from("clients").select()).data).toEqual(previousClients);
    expect((await restored.from("reminders").select()).data).toEqual(previousReminders);
    const connections = await restored.from("therapy_connections").select();
    expect(connections.error).toBeNull();
    expect(connections.data?.length).toBe(1);
    expect(connections.data?.[0].client_id).toBe(previousClients[0].id);
    expect((await restored.from("therapy_sessions").select()).data?.length).toBeGreaterThan(0);
    const migrated = JSON.parse(sessionStorage.getItem(DEMO_DATA_KEY)!);
    expect(migrated.rows.reminders).toEqual(previousReminders);
    expect(Array.isArray(migrated.rows.pre_session_notes)).toBeTrue();
  });

  it("migrates old state with no clients without manufacturing orphaned therapy rows", async () => {
    const stored = JSON.parse(sessionStorage.getItem(DEMO_DATA_KEY)!);
    stored.rows.clients = [];
    stored.rows.soap_notes = [];
    const previousMoods = stored.rows.mood_entries;
    for (const table of Object.keys(stored.rows)) {
      if (table.startsWith("therapy_") || table === "pre_session_notes") delete stored.rows[table];
    }
    sessionStorage.setItem(DEMO_DATA_KEY, JSON.stringify(stored));
    const restored = newClient();
    expect((await restored.from("clients").select()).data).toEqual([]);
    expect((await restored.from("mood_entries").select()).data).toEqual(previousMoods);
    for (const table of ["therapy_connections", "therapy_sessions", "pre_session_notes"]) {
      const result = await restored.from(table).select();
      expect(result.error).withContext(table).toBeNull();
      expect(result.data).withContext(table).toEqual([]);
    }
  });

  it("restarts sample data when the demo data key is reset", async () => {
    await client.from("soap_notes").delete().eq("therapist_id", DEMO_USER_ID);
    expect((await client.from("soap_notes").select()).data).toEqual([]);
    sessionStorage.removeItem(DEMO_DATA_KEY);
    const restarted = newClient();
    expect((await restarted.from("clients").select()).data?.length).toBe(3);
    expect((await restarted.from("soap_notes").select()).data?.length).toBe(2);
  });

  it("protects clients with active, revoked or pending therapy connections and deletes only unlinked clients", async () => {
    const connection = await connected();
    const others = await client.from("clients").select().neq("id", connection.client_id).order("created_at");
    expect(others.error).toBeNull();
    const [unlinkedClient, pendingClient] = others.data!;
    const rejectsWithoutChanges = async (clientId: string) => {
      const before = sessionStorage.getItem(DEMO_DATA_KEY);
      const deleted = await client.from("clients").delete().eq("id", clientId);
      expect(deleted.error?.code).toBe("23503");
      expect(sessionStorage.getItem(DEMO_DATA_KEY)).toBe(before);
    };
    await rejectsWithoutChanges(connection.client_id);
    expect((await client.rpc("revoke_therapy_connection", { p_connection_id: connection.id })).error).toBeNull();
    await rejectsWithoutChanges(connection.client_id);
    const invite = await client.rpc("create_therapy_invite", {
      p_client_id: pendingClient.id, p_therapist_name: "Dr. Sam Demo",
    });
    expect(invite.error).toBeNull();
    expect(invite.data.connection.user_id).toBeNull();
    await rejectsWithoutChanges(pendingClient.id);
    const beforeBulkDelete = sessionStorage.getItem(DEMO_DATA_KEY);
    expect((await client.from("clients").delete().eq("therapist_id", DEMO_USER_ID)).error?.code).toBe("23503");
    expect(sessionStorage.getItem(DEMO_DATA_KEY)).toBe(beforeBulkDelete);

    const before = JSON.parse(sessionStorage.getItem(DEMO_DATA_KEY)!).rows;
    expect(before.soap_notes.some((note: { client_id: string }) => note.client_id === unlinkedClient.id)).toBeTrue();
    const deleted = await client.from("clients").delete().eq("id", unlinkedClient.id).select().single();
    expect(deleted.error).toBeNull();
    expect(deleted.data!.id).toBe(unlinkedClient.id);
    const after = JSON.parse(sessionStorage.getItem(DEMO_DATA_KEY)!).rows;
    for (const table of Object.keys(before)) {
      const expected = table === "clients" ? before[table].filter((row: { id: string }) => row.id !== unlinkedClient.id)
        : table === "soap_notes" ? before[table].filter((row: { client_id: string }) => row.client_id !== unlinkedClient.id)
        : before[table];
      expect(after[table]).withContext(table).toEqual(expected);
    }
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
