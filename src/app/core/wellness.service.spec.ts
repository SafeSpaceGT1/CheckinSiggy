import { signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { provideTanStackQuery, QueryClient } from "@tanstack/angular-query-experimental";
import { AuthService } from "./auth.service";
import { supabase } from "./supabase.client";
import { dayKey } from "./streak";
import { goalWeekCount, MEDITATIONS, WellnessGoal, WellnessService } from "./wellness.service";

const goal = (dates: string[]): WellnessGoal => ({
  id: "goal-a", title: "Walk outside", target_per_week: 3, completed_dates: dates,
  created_at: "2026-09-01T12:00:00Z", updated_at: "2026-09-01T12:00:00Z",
});

describe("wellness calendar totals", () => {
  it("counts distinct local dates from Monday through today, excluding future and invalid dates", () => {
    const now = new Date(2026, 8, 9, 9); // Wednesday morning; today's noon is still in the future.
    expect(goalWeekCount(goal([
      "2026-09-06", "2026-09-07", "2026-09-07", "2026-09-09", "2026-09-10",
      "2027-01-01", "bad-date", "2026-09-99",
    ]), now)).toBe(2);
  });

  it("resets at local Monday midnight, including across a year boundary", () => {
    expect(goalWeekCount(goal(["2025-12-28", "2025-12-29", "2026-01-01", "2026-01-02"]),
      new Date(2026, 0, 1, 0, 1))).toBe(2);
  });
});

interface ApiResult { data: unknown; error: { message: string } | null }

describe("WellnessService ownership and input validation", () => {
  let service: WellnessService;
  let client: QueryClient;
  let currentUser: ReturnType<typeof signal<{ id: string } | null>>;
  let readResponse: ApiResult | Promise<ApiResult>;
  let writeResponse: ApiResult;
  let insert: jasmine.Spy;
  let equals: jasmine.Spy;
  let remove: jasmine.Spy;
  let from: jasmine.Spy;

  beforeEach(() => {
    currentUser = signal<{ id: string } | null>({ id: "owner-a" });
    readResponse = { data: [], error: null };
    writeResponse = { data: { id: "goal-a" }, error: null };
    insert = jasmine.createSpy("insert").and.callFake(() => Promise.resolve(writeResponse));
    equals = jasmine.createSpy("eq");
    remove = jasmine.createSpy("delete");
    const builder = {
      select: jasmine.createSpy("select"),
      eq: equals,
      order: jasmine.createSpy("order"),
      limit: jasmine.createSpy("limit"),
      abortSignal: jasmine.createSpy("abortSignal"),
      delete: remove,
      insert,
      single: jasmine.createSpy("single").and.callFake(() => Promise.resolve(writeResponse)),
      then: (resolve: (value: ApiResult) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(readResponse).then(resolve, reject),
    };
    for (const spy of [builder.select, equals, builder.order, builder.limit, builder.abortSignal, remove]) {
      spy.and.returnValue(builder);
    }
    from = spyOn(supabase, "from").and.returnValue(builder as never);
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    TestBed.configureTestingModule({
      providers: [provideTanStackQuery(client), {
        provide: AuthService,
        useValue: {
          user: currentUser,
          requireUserId: () => {
            const id = currentUser()?.id;
            if (!id) throw new Error("You need to be signed in.");
            return id;
          },
          assertUser: (id: string) => {
            if (id !== currentUser()?.id) throw new Error("Your account changed. Please try again.");
          },
        },
      }],
    });
    service = TestBed.inject(WellnessService);
  });

  afterEach(() => {
    client.clear();
    TestBed.resetTestingModule();
  });

  it("applies the signed-in owner filter to every list query", async () => {
    await service.goalsQuery.refetch();
    await service.sessionsQuery.refetch();
    await service.exerciseQuery.refetch();
    for (const table of ["wellness_goals", "meditation_sessions", "exercise_logs"]) {
      expect(from).toHaveBeenCalledWith(table);
    }
    expect(equals.calls.count()).toBeGreaterThanOrEqual(3);
    expect(equals.calls.allArgs().every(([column, owner]) => column === "user_id" && owner === "owner-a"))
      .toBeTrue();
  });

  it("reports read failures instead of treating unavailable data as an empty history", async () => {
    readResponse = { data: null, error: { message: "Database unavailable" } };
    await expectAsync(service.goalsQuery.refetch({ throwOnError: true }))
      .toBeRejectedWithError("Database unavailable");
    expect(client.getQueryData(["wellness-goals", "owner-a"])).toBeUndefined();
  });

  it("rejects a pending account-A response after the account changes", async () => {
    let finish!: (value: ApiResult) => void;
    readResponse = new Promise<ApiResult>((resolve) => { finish = resolve; });
    const pending = service.goalsQuery.refetch({ throwOnError: true });
    currentUser.set({ id: "owner-b" });
    finish({ data: [goal(["2026-09-07"])], error: null });
    await expectAsync(pending).toBeRejectedWithError(/account changed/);
    expect(client.getQueryData(["wellness-goals", "owner-a"])).toBeUndefined();
    expect(client.getQueryData(["wellness-goals", "owner-b"])).toBeUndefined();
    expect(equals).toHaveBeenCalledWith("user_id", "owner-a");
  });

  it("requires authentication for deletion and never contacts the database when signed out", async () => {
    currentUser.set(null);
    await expectAsync(service.deleteGoalMutation.mutateAsync("goal-a")).toBeRejectedWithError(/signed in/);
    await expectAsync(service.deleteExerciseMutation.mutateAsync("log-a")).toBeRejectedWithError(/signed in/);
    expect(remove).not.toHaveBeenCalled();
  });

  it("scopes deletes to both owner and record, and only invalidates that owner's history", async () => {
    const invalidate = spyOn(client, "invalidateQueries").and.resolveTo();
    await service.deleteExerciseMutation.mutateAsync("log-a");
    expect(equals).toHaveBeenCalledWith("user_id", "owner-a");
    expect(equals).toHaveBeenCalledWith("id", "log-a");
    expect(invalidate).toHaveBeenCalledOnceWith({ queryKey: ["exercise-logs", "owner-a"] });
  });

  it("does not report successful deletion when the owner cannot access the record", async () => {
    writeResponse = { data: null, error: { message: "No row found" } };
    await expectAsync(service.deleteGoalMutation.mutateAsync("someone-elses-goal"))
      .toBeRejectedWithError("No row found");
  });

  it("uses the atomic goal RPC instead of resubmitting a stale completed_dates array", async () => {
    const rpc = spyOn(supabase, "rpc").and.returnValue(Promise.resolve(writeResponse) as never);
    await service.toggleGoalTodayMutation.mutateAsync(goal(["2026-09-01"]));
    expect(rpc).toHaveBeenCalledOnceWith("toggle_wellness_goal_today", {
      goal_id: "goal-a", completion_date: dayKey(new Date()),
    });
  });

  it("rejects empty goals and impossible daily completion targets before insertion", async () => {
    for (const payload of [
      { title: "  ", target_per_week: 3 }, { title: "Walk", target_per_week: 8 },
      { title: "Walk", target_per_week: 1.5 }, { title: "Walk", target_per_week: NaN },
    ]) {
      await expectAsync(service.addGoalMutation.mutateAsync(payload)).toBeRejected();
    }
    expect(insert).not.toHaveBeenCalled();
  });

  it("validates finite whole exercise minutes and intensity before insertion", async () => {
    const exercise = { activity: "Walk", minutes: 20, intensity: "light" as const, notes: null };
    for (const minutes of [-1, 0, 0.5, NaN, Infinity, 1441]) {
      await expectAsync(service.logExerciseMutation.mutateAsync({ ...exercise, minutes })).toBeRejected();
    }
    await expectAsync(service.logExerciseMutation.mutateAsync({ ...exercise, intensity: "invalid" as "light" }))
      .toBeRejectedWithError(/intensity/);
    expect(insert).not.toHaveBeenCalled();
  });

  it("writes validated fields without allowing a payload to override the signed-in owner", async () => {
    const payload = { title: "  Get outside  ", target_per_week: 3, user_id: "owner-b" };
    await service.addGoalMutation.mutateAsync(payload);
    expect(insert).toHaveBeenCalledOnceWith({ user_id: "owner-a", title: "Get outside", target_per_week: 3 });
  });

  it("bounds meditation time by the canonical library entry", async () => {
    const item = { ...MEDITATIONS[0], title: "Injected title", minutes: 999 };
    await expectAsync(service.logMeditationMutation.mutateAsync({ item, completedSeconds: 61 })).toBeRejected();
    await service.logMeditationMutation.mutateAsync({ item, completedSeconds: 60 });
    expect(insert).toHaveBeenCalledOnceWith({
      user_id: "owner-a", meditation_id: "one-minute-reset", title: "One-Minute Reset",
      duration_minutes: 1, completed_seconds: 60,
    });
  });

  it("excludes future, invalid and duplicate records from the current week's activity totals", () => {
    const now = new Date();
    const log = { id: "log-a", activity: "Walk", minutes: 15, intensity: "light", notes: null,
      created_at: now.toISOString() };
    client.setQueryData(["exercise-logs", "owner-a"], [
      log, log, { ...log, id: "future", created_at: new Date(now.getTime() + 86400000).toISOString() },
      { ...log, id: "old", created_at: new Date(now.getTime() - 8 * 86400000).toISOString() },
      { ...log, id: "invalid", created_at: "not-a-date" },
    ]);
    expect(service.activeMinutesThisWeek()).toBe(15);
    const days = [0, 0, 0, 0, 0, 0, 0];
    days[(now.getDay() + 6) % 7] = 15;
    expect(service.exerciseByDay()).toEqual(days);
  });
});
