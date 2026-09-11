import { computeStreaks } from "./streak";

describe("local-day streaks", () => {
  beforeEach(() => { jasmine.clock().install(); jasmine.clock().mockDate(new Date(2026, 8, 11, 15)); });
  afterEach(() => jasmine.clock().uninstall());
  it("counts one streak day per local date but preserves multiple check-ins in the total", () => {
    expect(computeStreaks(["2026-09-11T09:00:00", "2026-09-11T10:00:00", "2026-09-10T23:00:00"]))
      .toEqual({ currentStreak: 2, bestStreak: 2, hasCheckedInToday: true, totalCheckIns: 3 });
  });
  it("keeps yesterday's streak until today's check-in", () => {
    expect(computeStreaks(["2026-09-09T12:00:00", "2026-09-10T12:00:00"]))
      .toEqual({ currentStreak: 2, bestStreak: 2, hasCheckedInToday: false, totalCheckIns: 2 });
  });
  it("ignores malformed and future timestamps instead of throwing or inflating streaks", () => {
    expect(computeStreaks(["bad", "2026-09-12T12:00:00", "2026-09-11T09:00:00"]))
      .toEqual({ currentStreak: 1, bestStreak: 1, hasCheckedInToday: true, totalCheckIns: 1 });
  });
  it("calculates the longest earlier run after a gap", () => {
    expect(computeStreaks(["2026-09-01T12:00:00", "2026-09-02T12:00:00", "2026-09-03T12:00:00", "2026-09-11T09:00:00"]).bestStreak).toBe(3);
  });
});
