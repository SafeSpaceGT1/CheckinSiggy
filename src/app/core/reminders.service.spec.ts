import { signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { Router } from "@angular/router";
import { provideTanStackQuery, QueryClient } from "@tanstack/angular-query-experimental";
import { MessageService } from "primeng/api";
import { AuthService } from "./auth.service";
import { Reminder, RemindersService, validateReminder, REMINDER_NOTIFICATION_BODY } from "./reminders.service";
import { normalizeSettings } from "./settings.service";

const reminder: Reminder = { id: "test-reminder", title: "Private medical reminder", kind: "journal",
  time_of_day: "09:00:00", days_of_week: [5], enabled: true,
  created_at: "2026-09-01T12:00:00Z", updated_at: "2026-09-01T12:00:00Z" };

describe("reminder validation", () => {
  it("rejects invalid times, empty day lists and unsupported types", () => {
    for (const time_of_day of ["25:00", "10:65", "9:00", "invalid"]) {
      expect(() => validateReminder({ ...reminder, time_of_day })).toThrowError(/valid reminder time/);
    }
    expect(() => validateReminder({ ...reminder, days_of_week: [] })).toThrow();
    expect(() => validateReminder({ ...reminder, days_of_week: [7] })).toThrow();
    expect(() => validateReminder({ ...reminder, kind: "bad" as "journal" })).toThrow();
  });
  it("trims titles and removes duplicate weekdays", () => {
    expect(validateReminder({ ...reminder, title: "  Check in  ", days_of_week: [5, 1, 5] }))
      .toEqual({ title: "Check in", kind: "journal", time_of_day: "09:00:00", days_of_week: [1, 5] });
  });
});

describe("reminder scheduler", () => {
  let service: RemindersService;
  let client: QueryClient;
  let user: ReturnType<typeof signal<{ id: string } | null>>;
  let messages: jasmine.Spy;
  let internal: { tick(): void };
  beforeEach(() => {
    jasmine.clock().install(); jasmine.clock().mockDate(new Date(2026, 8, 11, 9));
    user = signal<{ id: string } | null>({ id: "reminder-user-a" });
    messages = jasmine.createSpy("add");
    client = new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false } } });
    TestBed.configureTestingModule({ providers: [provideTanStackQuery(client),
      { provide: MessageService, useValue: { add: messages } }, { provide: Router, useValue: { navigate: jasmine.createSpy() } },
      { provide: AuthService, useValue: { user, assertUser: () => undefined } }] });
    client.setQueryData(["reminders", "reminder-user-a"], [reminder]);
    client.setQueryData(["reminders", "reminder-user-b"], [reminder]);
    service = TestBed.inject(RemindersService);
    service.permission.set("denied");
    internal = service as unknown as { tick(): void };
  });
  afterEach(() => {
    client.clear(); TestBed.resetTestingModule(); jasmine.clock().uninstall();
    localStorage.removeItem("siggy:reminders:fired:reminder-user-a");
    localStorage.removeItem("siggy:reminders:fired:reminder-user-b");
  });

  it("fires once per day even if device storage is unavailable", () => {
    spyOn(Storage.prototype, "getItem").and.throwError("Storage denied");
    spyOn(Storage.prototype, "setItem").and.throwError("Storage denied");
    internal.tick(); internal.tick();
    expect(messages).toHaveBeenCalledTimes(1);
    expect(messages).toHaveBeenCalledWith(jasmine.objectContaining({ detail: REMINDER_NOTIFICATION_BODY }));
    expect(JSON.stringify(messages.calls.allArgs())).not.toContain(reminder.title);
  });

  it("handles corrupted storage and isolates deduplication by account", () => {
    localStorage.setItem("siggy:reminders:fired:reminder-user-a", "null");
    internal.tick(); internal.tick();
    user.set({ id: "reminder-user-b" });
    internal.tick();
    expect(messages).toHaveBeenCalledTimes(2);
  });

  it("does not notify signed-out users", () => {
    user.set(null);
    internal.tick();
    expect(messages).not.toHaveBeenCalled();
  });
});

describe("persisted settings validation", () => {
  it("falls back from malformed stored values", () => {
    expect(normalizeSettings({ theme: "invalid", hapticsEnabled: "no", soundEnabled: 0, reviewIntervalDays: -10 }))
      .toEqual({ theme: "system", hapticsEnabled: true, soundEnabled: true, reviewIntervalDays: 90 });
  });
});
