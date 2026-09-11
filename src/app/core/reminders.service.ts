import { DestroyRef, effect, inject, Injectable, signal } from "@angular/core";
import { Router } from "@angular/router";
import { format } from "date-fns";
import { MessageService } from "primeng/api";
import {
  injectMutation,
  injectQuery,
  QueryClient,
} from "@tanstack/angular-query-experimental";
import { supabase } from "./supabase.client";
import { AuthService } from "./auth.service";
import { dayKey } from "./streak";
import { requiredText } from "./data-validation";

export type ReminderKind = "mood_check" | "journal" | "meditation" | "custom";

export interface Reminder {
  id: string;
  title: string;
  kind: ReminderKind;
  time_of_day: string; // "HH:MM:SS" from Postgres
  days_of_week: number[]; // 0 (Sun) – 6 (Sat)
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface NewReminder {
  title: string;
  kind: ReminderKind;
  time_of_day: string; // "HH:MM"
  days_of_week: number[];
}

/**
 * PRIVACY: this is the only copy a notification ever carries. It never
 * includes anything the user wrote or how they're doing.
 */
export const REMINDER_NOTIFICATION_BODY = "Your SIGGY check-in is ready.";

const FIRED_STORAGE_KEY = "siggy:reminders:fired";

const KIND_ROUTES: Record<ReminderKind, string> = {
  mood_check: "/mood-check",
  journal: "/journal",
  meditation: "/progress",
  custom: "/",
};

export function validateReminder(payload: NewReminder): NewReminder {
  const title = requiredText(payload.title, "Reminder title", 200);
  if (!Object.hasOwn(KIND_ROUTES, payload.kind)) throw new Error("Choose a valid reminder type.");
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(payload.time_of_day)) {
    throw new Error("Choose a valid reminder time.");
  }
  if (!Array.isArray(payload.days_of_week) || payload.days_of_week.length === 0 ||
      payload.days_of_week.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
    throw new Error("Choose at least one valid reminder day.");
  }
  return { title, kind: payload.kind, time_of_day: payload.time_of_day,
    days_of_week: [...new Set(payload.days_of_week)].sort() };
}

@Injectable({ providedIn: "root" })
export class RemindersService {
  private readonly auth = inject(AuthService);
  private readonly queryClient = inject(QueryClient);
  private readonly messages = inject(MessageService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly firedInMemory = new Map<string, Record<string, string>>();

  readonly supported = typeof Notification !== "undefined";
  readonly permission = signal<NotificationPermission>(
    this.supported ? Notification.permission : "denied"
  );

  readonly remindersQuery = injectQuery(() => ({
    queryKey: ["reminders", this.auth.user()?.id],
    enabled: !!this.auth.user(),
    queryFn: async ({ queryKey, signal }): Promise<Reminder[]> => {
      const ownerId = queryKey[queryKey.length - 1] as string;
      this.auth.assertUser(ownerId);
      const { data, error } = await supabase
        .from("reminders")
        .select("id, title, kind, time_of_day, days_of_week, enabled, created_at, updated_at")
        .eq("user_id", ownerId)
        .abortSignal(signal)
        .order("time_of_day", { ascending: true });
      if (error) throw new Error(error.message);
      this.auth.assertUser(ownerId);
      return (data ?? []) as Reminder[];
    },
  }));

  readonly createMutation = injectMutation(() => ({
    mutationFn: async (payload: NewReminder) => {
      const userId = this.auth.user()?.id;
      if (!userId) throw new Error("You need to be signed in.");
      const { error } = await supabase.from("reminders").insert({ ...validateReminder(payload), user_id: userId });
      if (error) throw new Error(error.message);
      this.auth.assertUser(userId);
    },
    onSuccess: () => this.invalidate(),
  }));

  readonly toggleMutation = injectMutation(() => ({
    mutationFn: async (payload: { id: string; enabled: boolean }) => {
      const userId = this.auth.requireUserId();
      if (typeof payload.enabled !== "boolean") throw new Error("Invalid reminder status.");
      const { error } = await supabase
        .from("reminders")
        .update({ enabled: payload.enabled })
        .eq("id", payload.id).eq("user_id", userId).select("id").single();
      if (error) throw new Error(error.message);
      this.auth.assertUser(userId);
    },
    onSuccess: () => this.invalidate(),
  }));

  readonly deleteMutation = injectMutation(() => ({
    mutationFn: async (id: string) => {
      const userId = this.auth.requireUserId();
      const { error } = await supabase.from("reminders").delete()
        .eq("id", id).eq("user_id", userId).select("id").single();
      if (error) throw new Error(error.message);
      this.auth.assertUser(userId);
    },
    onSuccess: () => this.invalidate(),
  }));

  constructor() {
    // In-app scheduler: while SIGGY is open it checks twice a minute and
    // fires due reminders once per day each — as a device notification when
    // permitted, otherwise as an in-app toast. Same privacy-safe copy always.
    if (typeof window !== "undefined") {
      const interval = setInterval(() => this.tick(), 30_000);
      this.destroyRef.onDestroy(() => clearInterval(interval));
      // The first reminder can become due while data is loading.
      effect(() => { this.remindersQuery.data(); this.tick(); });
    }
  }

  async requestPermission(): Promise<NotificationPermission> {
    if (!this.supported) return "denied";
    try {
      const result = await Notification.requestPermission();
      this.permission.set(result);
      return result;
    } catch {
      this.permission.set("denied");
      return "denied";
    }
  }

  private invalidate() {
    return this.queryClient.invalidateQueries({ queryKey: ["reminders", this.auth.user()?.id] });
  }

  private tick() {
    const userId = this.auth.user()?.id;
    if (!userId) return;
    const reminders = this.remindersQuery.data() ?? [];
    if (reminders.length === 0) return;

    const now = new Date();
    const currentTime = format(now, "HH:mm");
    const weekday = now.getDay();
    const today = dayKey(now);
    const fired = this.readFired(userId, today);

    for (const reminder of reminders) {
      const due =
        reminder.enabled &&
        reminder.time_of_day.slice(0, 5) === currentTime &&
        reminder.days_of_week.includes(weekday) &&
        fired[reminder.id] !== today;
      if (!due) continue;
      fired[reminder.id] = today;
      this.writeFired(userId, fired);
      this.fire(reminder);
    }
    this.writeFired(userId, fired);
  }

  private fire(reminder: Reminder) {
    if (this.supported && this.permission() === "granted") {
      try {
        const notification = new Notification("Check-In with SIGGY", {
          body: REMINDER_NOTIFICATION_BODY,
          icon: "/favicon.svg",
          tag: reminder.id,
        });
        notification.onclick = () => {
          window.focus();
          this.router.navigate([KIND_ROUTES[reminder.kind]]);
          notification.close();
        };
        return;
      } catch {
        // Some mobile browsers expose Notification but require a service worker.
      }
    }
    this.messages.add({
      severity: "info",
      summary: "Reminder",
      detail: REMINDER_NOTIFICATION_BODY,
      life: 8000,
    });
  }

  private readFired(userId: string, today: string): Record<string, string> {
    let stored: unknown;
    try {
      stored = JSON.parse(localStorage.getItem(`${FIRED_STORAGE_KEY}:${userId}`) ?? "{}");
    } catch { stored = {}; }
    const raw = stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
    const combined = { ...raw, ...this.firedInMemory.get(userId) };
    // Retain only today: the storage size stays bounded as reminders are deleted.
    return Object.fromEntries(Object.entries(combined).filter(([, day]) => day === today));
  }

  private writeFired(userId: string, map: Record<string, string>) {
    // Memory still prevents duplicate toasts while storage is blocked or full.
    this.firedInMemory.set(userId, { ...map });
    try {
      localStorage.setItem(`${FIRED_STORAGE_KEY}:${userId}`, JSON.stringify(map));
    } catch { /* Already retained in memory. */ }
  }
}
