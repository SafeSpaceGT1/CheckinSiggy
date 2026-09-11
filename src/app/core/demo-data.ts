import { DEMO_USER_ID } from "./demo-session";
import { localSentiment } from "./sentiment-local";

/** Flexible rows mirror the existing SQL tables; this data never leaves the tab. */
export type DemoRow = Record<string, any>;
export const DEMO_THERAPY_TABLES = [
  "therapy_connections", "therapy_connection_invites", "therapy_sessions", "pre_session_notes",
] as const;
export const DEMO_TABLES = [
  "mood_entries", "journal_entries", "sentiment_analyses", "wellness_goals",
  "meditation_sessions", "exercise_logs", "reminders", "crisis_plans",
  "crisis_warning_signs", "crisis_coping_strategies", "crisis_distractions",
  "crisis_support_contacts", "crisis_professional_contacts", "crisis_safety_steps",
  "crisis_reasons_for_living", "crisis_plan_shares", "clients", "soap_notes",
  ...DEMO_THERAPY_TABLES,
] as const;
export type DemoTable = typeof DEMO_TABLES[number];
export type DemoDatabase = Record<DemoTable, DemoRow[]>;

export function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Both fictional personas share one local identity so visitors can try either side. */
export function seedDemoTherapyData(rows: DemoDatabase, now = new Date()): void {
  const client = rows.clients.find((row) => row['therapist_id'] === DEMO_USER_ID);
  if (!client) return;
  const dated = (days: number) => new Date(now.getTime() + days * 86400000).toISOString();
  const connectionId = "dddddddd-dddd-4ddd-8ddd-000000001001";
  rows.therapy_connections = [{ id: connectionId, therapist_id: DEMO_USER_ID,
    client_id: client['id'], user_id: DEMO_USER_ID, therapist_name: "Dr. Taylor Morgan (demo)",
    created_at: dated(-14), revoked_at: null }];
  // The next appointment stays outside the prompt window until a visitor schedules one.
  rows.therapy_sessions = [2, 5, -5].map((days, index) => ({
    id: `dddddddd-dddd-4ddd-8ddd-${String(1002 + index).padStart(12, "0")}`,
    connection_id: connectionId, user_id: DEMO_USER_ID, therapist_id: DEMO_USER_ID,
    starts_at: dated(days), duration_minutes: 50, status: "scheduled",
    created_at: dated(-7), updated_at: dated(-7),
  }));
  rows.pre_session_notes = [{ session_id: rows.therapy_sessions[2]['id'], user_id: DEMO_USER_ID,
    body: "Fictional demo note: I would like to talk about keeping a steady evening routine and what helped me pause during a busy week.",
    status: "submitted", submitted_at: dated(-6), reviewed_at: dated(-5), updated_at: dated(-5) }];
}

/** Seed dates relative to today so calendar, streaks and charts remain useful. */
export function seedDemoData(now = new Date()): DemoDatabase {
  const rows = Object.fromEntries(DEMO_TABLES.map((table) => [table, [] as DemoRow[]])) as DemoDatabase;
  let sequence = 1;
  const date = (daysAgo: number) => {
    const value = new Date(now);
    value.setDate(value.getDate() - daysAgo);
    return value;
  };
  const add = (table: DemoTable, daysAgo: number, values: DemoRow) => {
    const created = date(daysAgo).toISOString();
    const owner = table === "clients" || table === "soap_notes" ? "therapist_id" : "user_id";
    const row: DemoRow = { id: `dddddddd-dddd-4ddd-8ddd-${String(sequence++).padStart(12, "0")}`,
      [owner]: DEMO_USER_ID, created_at: created, updated_at: created, ...values };
    rows[table].push(row);
    return row;
  };
  const values = [4, 4, 5, 3, 4, 4, 3, 4, 5, 3, 4, 3, 3, 2, 4, 3, 4, 2, 3, 3, 4, 2, 3, 3, 2, 3, 4, 3];
  values.forEach((value, index) => add("mood_entries", index, {
    value, emoji: ["", "😢", "🙁", "😐", "🙂", "😄"][value], rating_10: value * 2,
    notes: ["Sample check-in: a short walk helped me feel steady.",
      "Sample check-in: a busy day; I made time for a breathing break.",
      "Sample check-in: grateful for time with a friend."][index % 3],
    tags: index % 3 === 0 ? ["Exercise", "Sleep"] : index % 3 === 1 ? ["Work", "Stress"] : ["Friends", "Gratitude"],
    add_to_next_session: index === 3 || index === 8,
  }));
  const journals = [
    "I felt calm after a walk this morning. I am proud that I kept a small promise to myself.",
    "A busy afternoon left me tired, but a breathing break helped. I want to notice when I need a pause.",
    "I enjoyed catching up with a friend. I felt connected and grateful for that conversation.",
    "I was worried about a presentation. Breaking it into smaller steps made the task feel manageable.",
    "I slept better and had more energy. A simple evening routine seems worth trying again.",
    "Today was fairly ordinary. I made dinner, read a few pages, and wrote down tomorrow's priorities.",
    "I felt frustrated when plans changed. I took a moment to reset before choosing what to do next.",
    "I am hopeful about making more time for activities I enjoy. Small steps are still progress.",
  ];
  journals.forEach((content, index) => {
    const entry = add("journal_entries", index * 2, { content: `(Fictional demo entry) ${content}`,
      mood: ["🙂", "😐", "😄", "🙁"][index % 4] });
    const result = localSentiment(content);
    add("sentiment_analyses", index * 2, { journal_entry_id: entry['id'], ...result,
      summary: `Demo reflection — ${result.summary}`, source: "local" });
  });
  add("wellness_goals", 14, { title: "Take a 15-minute walk", target_per_week: 4,
    completed_dates: [1, 2, 4, 7, 8].map((days) => localDate(date(days))) });
  add("wellness_goals", 12, { title: "Make time for a breathing break", target_per_week: 5,
    completed_dates: [0, 1, 3, 6, 7].map((days) => localDate(date(days))) });
  add("wellness_goals", 7, { title: "Write a few lines in my journal", target_per_week: 3,
    completed_dates: [0, 2, 4].map((days) => localDate(date(days))) });
  [1, 3, 5, 8, 10].forEach((days) => add("meditation_sessions", days, {
    meditation_id: "one-minute-reset", title: "One-Minute Reset", duration_minutes: 1, completed_seconds: 60,
  }));
  [1, 2, 4, 7, 8].forEach((days) => add("exercise_logs", days, {
    activity: days % 2 ? "Walk outdoors" : "Stretching", minutes: days % 2 ? 20 : 10,
    intensity: "light", notes: "Fictional sample movement log.",
  }));
  add("reminders", 10, { title: "Morning mood check", kind: "mood_check", time_of_day: "09:00:00",
    days_of_week: [1, 2, 3, 4, 5], enabled: false });
  add("reminders", 10, { title: "Evening journal", kind: "journal", time_of_day: "20:30:00",
    days_of_week: [0, 1, 2, 3, 4, 5, 6], enabled: false });
  const plan = add("crisis_plans", 12, {});
  const child = (table: DemoTable, values: DemoRow) => add(table, 12,
    { plan_id: plan['id'], position: rows[table].length, ...values });
  child("crisis_warning_signs", { text: "Sample: withdrawing from activities I usually enjoy." });
  child("crisis_warning_signs", { text: "Sample: feeling overwhelmed and finding it hard to pause." });
  child("crisis_coping_strategies", { text: "Sample: take a grounding break and notice the room around me." });
  child("crisis_coping_strategies", { text: "Sample: listen to a familiar, calming playlist." });
  child("crisis_distractions", { name: "Sample neighborhood park", phone: null, kind: "place" });
  child("crisis_support_contacts", { name: "Sam (fictional support person)", phone: null, relationship: "Friend" });
  child("crisis_professional_contacts", { name: "Demo care team", organization: "Fictional sample practice", phone: null });
  child("crisis_safety_steps", { text: "Sample: review my plan with a trusted support person." });
  child("crisis_reasons_for_living", { text: "Sample: the people I care about and experiences I look forward to." });
  const clients = ["Jordan Lane", "Casey Morgan", "Taylor Reed"].map((name, index) => add("clients", 20 - index,
    { name: `${name} (sample)`, email: `sample.client${index + 1}@example.invalid`, phone: null }));
  add("soap_notes", 2, { client_id: clients[0]['id'], format: "SOAP", session_date: localDate(date(2)), content: {
    subjective: "Fictional training example: client described practicing a short daily pause.",
    objective: "Fictional training example: client participated in a review of coping strategies.",
    assessment: "Sample note for exploring the interface; not a clinical record.",
    plan: "Sample next step: review the practice at the next fictional session.",
  } });
  add("soap_notes", 5, { client_id: clients[1]['id'], format: "DAP", session_date: localDate(date(5)), content: {
    data: "Fictional training example: discussed a weekly routine and enjoyable activities.",
    assessment: "Sample note for exploring the interface; not a clinical record.",
    plan: "Sample next step: choose one small activity to practice.",
  } });
  seedDemoTherapyData(rows, now);
  return rows;
}
