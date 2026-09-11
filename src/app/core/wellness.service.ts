import { computed, inject, Injectable } from "@angular/core";
import { startOfWeek } from "date-fns";
import {
  injectMutation,
  injectQuery,
  QueryClient,
} from "@tanstack/angular-query-experimental";
import { supabase } from "./supabase.client";
import { AuthService } from "./auth.service";
import { dayKey } from "./streak";

export interface WellnessGoal {
  id: string;
  title: string;
  target_per_week: number;
  completed_dates: string[];
  created_at: string;
  updated_at: string;
}

export interface MeditationSession {
  id: string;
  meditation_id: string;
  title: string;
  duration_minutes: number;
  completed_seconds: number;
  created_at: string;
}

export type ExerciseIntensity = "light" | "moderate" | "vigorous";

export interface ExerciseLog {
  id: string;
  activity: string;
  minutes: number;
  intensity: ExerciseIntensity;
  notes: string | null;
  created_at: string;
}

export interface MeditationItem {
  id: string;
  title: string;
  description: string;
  minutes: number;
  emoji: string;
}

/** Built-in guided library. Completing one logs a meditation_sessions row. */
export const MEDITATIONS: MeditationItem[] = [
  {
    id: "one-minute-reset",
    title: "One-Minute Reset",
    minutes: 1,
    emoji: "⏸️",
    description: "Sixty seconds of just breathing. Enough to change the moment.",
  },
  {
    id: "breathing-478",
    title: "4-7-8 Breathing",
    minutes: 3,
    emoji: "🌬️",
    description: "In for 4, hold for 7, out for 8 — a slow rhythm that settles the body.",
  },
  {
    id: "grounding-54321",
    title: "5-4-3-2-1 Grounding",
    minutes: 5,
    emoji: "🌳",
    description: "Five things you see, four you feel, three you hear, two you smell, one you taste.",
  },
  {
    id: "loving-kindness",
    title: "Loving-Kindness",
    minutes: 8,
    emoji: "💜",
    description: "Offer easy phrases of goodwill — to yourself first, then outward.",
  },
  {
    id: "body-scan",
    title: "Body Scan",
    minutes: 10,
    emoji: "🧘",
    description: "Move attention slowly from head to toe, noticing without changing anything.",
  },
  {
    id: "sleep-winddown",
    title: "Sleep Wind-Down",
    minutes: 12,
    emoji: "🌙",
    description: "Slow breaths and a loosening body, letting the day set itself down.",
  },
];

function thisWeekStart(now = new Date()): Date {
  return startOfWeek(now, { weekStartsOn: 1 });
}

/** Calendar dates are local days, not UTC timestamps. Count each valid day once. */
export function goalWeekCount(goal: WellnessGoal, now = new Date()): number {
  const weekStart = dayKey(thisWeekStart(now));
  const today = dayKey(now);
  return [...new Set(goal.completed_dates)].filter((date) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < weekStart || date > today) return false;
    const parsed = new Date(`${date}T12:00:00`);
    return Number.isFinite(parsed.getTime()) && dayKey(parsed) === date;
  }).length;
}

export function goalDoneToday(goal: WellnessGoal): boolean {
  return goal.completed_dates.includes(dayKey(new Date()));
}

function requiredText(value: string, label: string, limit: number): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  const text = value.trim();
  if (text.length > limit) throw new Error(`${label} must be ${limit} characters or fewer.`);
  return text;
}

function integerInRange(value: number, label: string, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be a whole number from ${min} to ${max}.`);
  }
  return value;
}

function currentWeekRecords<T extends { id: string; created_at: string }>(records: T[], now: Date): T[] {
  const weekStart = thisWeekStart(now).getTime();
  const seen = new Set<string>();
  return records.filter((record) => {
    const timestamp = new Date(record.created_at).getTime();
    if (!Number.isFinite(timestamp) || timestamp < weekStart || timestamp > now.getTime() || seen.has(record.id)) {
      return false;
    }
    seen.add(record.id);
    return true;
  });
}

@Injectable({ providedIn: "root" })
export class WellnessService {
  private readonly auth = inject(AuthService);
  private readonly queryClient = inject(QueryClient);

  // ----- Goals --------------------------------------------------------------

  readonly goalsQuery = injectQuery(() => ({
    queryKey: ["wellness-goals", this.auth.user()?.id] as const,
    enabled: !!this.auth.user(),
    queryFn: async ({ queryKey, signal }): Promise<WellnessGoal[]> => {
      const userId = this.queryOwner(queryKey[1]);
      const { data, error } = await supabase
        .from("wellness_goals")
        .select("id, title, target_per_week, completed_dates, created_at, updated_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: true })
        .abortSignal(signal);
      this.auth.assertUser(userId);
      if (error) throw new Error(error.message);
      return (data ?? []) as WellnessGoal[];
    },
  }));

  readonly goalsMet = computed(() => {
    const goals = this.goalsQuery.data() ?? [];
    return {
      met: goals.filter((goal) => goalWeekCount(goal) >= goal.target_per_week).length,
      total: goals.length,
    };
  });

  readonly addGoalMutation = injectMutation(() => ({
    mutationFn: async (payload: { title: string; target_per_week: number }) => {
      const userId = this.auth.requireUserId();
      const { error } = await supabase.from("wellness_goals").insert({
        user_id: userId,
        title: requiredText(payload.title, "Goal", 120),
        target_per_week: integerInRange(payload.target_per_week, "Weekly target", 1, 7),
      });
      this.auth.assertUser(userId);
      if (error) throw new Error(error.message);
      return userId;
    },
    onSuccess: (userId) => this.invalidate("wellness-goals", userId),
  }));

  readonly toggleGoalTodayMutation = injectMutation(() => ({
    mutationFn: async (goal: WellnessGoal) => {
      const userId = this.auth.requireUserId();
      // The database toggles under a row lock; stale views cannot overwrite other completions.
      const { error } = await supabase.rpc("toggle_wellness_goal_today", {
        goal_id: requiredText(goal.id, "Goal ID", 128),
        completion_date: dayKey(new Date()),
      });
      this.auth.assertUser(userId);
      if (error) throw new Error(error.message);
      return userId;
    },
    onSuccess: (userId) => this.invalidate("wellness-goals", userId),
  }));

  readonly deleteGoalMutation = injectMutation(() => ({
    mutationFn: async (id: string) => {
      const userId = this.auth.requireUserId();
      const { data, error } = await supabase.from("wellness_goals").delete()
        .eq("user_id", userId).eq("id", requiredText(id, "Goal ID", 128)).select("id").single();
      this.auth.assertUser(userId);
      if (error) throw new Error(error.message);
      if (!data) throw new Error("This goal could not be found.");
      return userId;
    },
    onSuccess: (userId) => this.invalidate("wellness-goals", userId),
  }));

  // ----- Meditation ----------------------------------------------------------

  readonly sessionsQuery = injectQuery(() => ({
    queryKey: ["meditation-sessions", this.auth.user()?.id] as const,
    enabled: !!this.auth.user(),
    queryFn: async ({ queryKey, signal }): Promise<MeditationSession[]> => {
      const userId = this.queryOwner(queryKey[1]);
      const { data, error } = await supabase
        .from("meditation_sessions")
        .select("id, meditation_id, title, duration_minutes, completed_seconds, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(100)
        .abortSignal(signal);
      this.auth.assertUser(userId);
      if (error) throw new Error(error.message);
      return (data ?? []) as MeditationSession[];
    },
  }));

  readonly mindfulMinutesThisWeek = computed(() => {
    const seconds = currentWeekRecords(this.sessionsQuery.data() ?? [], new Date())
      .filter((session) => Number.isFinite(session.completed_seconds) && session.completed_seconds > 0)
      .reduce((sum, session) => sum + session.completed_seconds, 0);
    return Math.round(seconds / 60);
  });

  readonly logMeditationMutation = injectMutation(() => ({
    mutationFn: async (payload: { item: MeditationItem; completedSeconds: number }) => {
      const userId = this.auth.requireUserId();
      const item = MEDITATIONS.find((meditation) => meditation.id === payload.item.id);
      if (!item) throw new Error("Choose a meditation from the library.");
      const { error } = await supabase.from("meditation_sessions").insert({
        user_id: userId,
        meditation_id: item.id,
        title: item.title,
        duration_minutes: item.minutes,
        completed_seconds: integerInRange(payload.completedSeconds, "Completed seconds", 1, item.minutes * 60),
      });
      this.auth.assertUser(userId);
      if (error) throw new Error(error.message);
      return userId;
    },
    onSuccess: (userId) => this.invalidate("meditation-sessions", userId),
  }));

  // ----- Exercise -------------------------------------------------------------

  readonly exerciseQuery = injectQuery(() => ({
    queryKey: ["exercise-logs", this.auth.user()?.id] as const,
    enabled: !!this.auth.user(),
    queryFn: async ({ queryKey, signal }): Promise<ExerciseLog[]> => {
      const userId = this.queryOwner(queryKey[1]);
      const { data, error } = await supabase
        .from("exercise_logs")
        .select("id, activity, minutes, intensity, notes, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(200)
        .abortSignal(signal);
      this.auth.assertUser(userId);
      if (error) throw new Error(error.message);
      return (data ?? []) as ExerciseLog[];
    },
  }));

  readonly activeMinutesThisWeek = computed(() => {
    return currentWeekRecords(this.exerciseQuery.data() ?? [], new Date())
      .filter((log) => Number.isFinite(log.minutes) && log.minutes > 0)
      .reduce((sum, log) => sum + log.minutes, 0);
  });

  /** Minutes per day, Monday-first, for the current week. */
  readonly exerciseByDay = computed(() => {
    const byDay = [0, 0, 0, 0, 0, 0, 0];
    for (const log of currentWeekRecords(this.exerciseQuery.data() ?? [], new Date())) {
      const date = new Date(log.created_at);
      if (!Number.isFinite(log.minutes) || log.minutes <= 0) continue;
      const mondayFirst = (date.getDay() + 6) % 7;
      byDay[mondayFirst] += log.minutes;
    }
    return byDay;
  });

  readonly logExerciseMutation = injectMutation(() => ({
    mutationFn: async (payload: {
      activity: string;
      minutes: number;
      intensity: ExerciseIntensity;
      notes: string | null;
    }) => {
      const userId = this.auth.requireUserId();
      if (!["light", "moderate", "vigorous"].includes(payload.intensity)) {
        throw new Error("Choose a valid exercise intensity.");
      }
      const notes = payload.notes?.trim() || null;
      if (notes && notes.length > 2000) throw new Error("Notes must be 2000 characters or fewer.");
      const { error } = await supabase.from("exercise_logs").insert({
        user_id: userId,
        activity: requiredText(payload.activity, "Activity", 120),
        minutes: integerInRange(payload.minutes, "Minutes", 1, 1440),
        intensity: payload.intensity,
        notes,
      });
      this.auth.assertUser(userId);
      if (error) throw new Error(error.message);
      return userId;
    },
    onSuccess: (userId) => this.invalidate("exercise-logs", userId),
  }));

  readonly deleteExerciseMutation = injectMutation(() => ({
    mutationFn: async (id: string) => {
      const userId = this.auth.requireUserId();
      const { data, error } = await supabase.from("exercise_logs").delete()
        .eq("user_id", userId).eq("id", requiredText(id, "Exercise ID", 128)).select("id").single();
      this.auth.assertUser(userId);
      if (error) throw new Error(error.message);
      if (!data) throw new Error("This exercise log could not be found.");
      return userId;
    },
    onSuccess: (userId) => this.invalidate("exercise-logs", userId),
  }));

  private queryOwner(userId: string | undefined): string {
    if (!userId) throw new Error("You need to be signed in.");
    this.auth.assertUser(userId);
    return userId;
  }

  private invalidate(key: string, userId: string) {
    return this.queryClient.invalidateQueries({ queryKey: [key, userId] });
  }
}
