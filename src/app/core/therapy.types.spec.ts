import { isSessionDue, PRE_SESSION_WINDOW_MS, TherapySession, validatePreSessionNote, validateSessionInput } from "./therapy.types";

describe("Therapy session timing and validation", () => {
  const now = Date.parse("2026-09-12T15:00:00Z");
  const session = (offset: number, status: "scheduled" | "cancelled" = "scheduled"): TherapySession => ({
    id: "session", connection_id: "connection", user_id: "client", therapist_id: "therapist",
    starts_at: new Date(now + offset).toISOString(), duration_minutes: 50, status,
    created_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString(),
  });

  it("starts prompting at exactly 24 hours and stops at the appointment start", () => {
    expect(isSessionDue(session(PRE_SESSION_WINDOW_MS + 1), now)).toBeFalse();
    expect(isSessionDue(session(PRE_SESSION_WINDOW_MS), now)).toBeTrue();
    expect(isSessionDue(session(1), now)).toBeTrue();
    expect(isSessionDue(session(0), now)).toBeFalse();
    expect(isSessionDue(session(-1), now)).toBeFalse();
  });

  it("excludes cancelled and invalid appointments", () => {
    expect(isSessionDue(session(3_600_000, "cancelled"), now)).toBeFalse();
    expect(isSessionDue({ ...session(1000), starts_at: "invalid" }, now)).toBeFalse();
  });

  it("compares instants across time zones", () => {
    const zoned = { ...session(1000), starts_at: "2026-09-12T11:30:00-04:00" };
    expect(isSessionDue(zoned, now)).toBeTrue();
    expect(isSessionDue(zoned, Date.parse("2026-09-12T16:30:00+01:00"))).toBeFalse();
  });

  it("normalizes a scheduled time to UTC without changing the instant", () => {
    expect(validateSessionInput({ connection_id: "linked", starts_at: "2026-09-12T12:30:00-04:00", duration_minutes: 50 }, now).starts_at)
      .toBe("2026-09-12T16:30:00.000Z");
  });

  it("rejects missing connections, past dates, and invalid durations", () => {
    const input = { connection_id: "linked", starts_at: "2026-09-13T15:00:00Z", duration_minutes: 50 };
    for (const change of [{ connection_id: "" }, { starts_at: "bad" }, { starts_at: new Date(now).toISOString() },
      { starts_at: "2027-09-12T15:00:00Z" }, { duration_minutes: 14 }, { duration_minutes: 181 }, { duration_minutes: 50.5 }]) {
      expect(() => validateSessionInput({ ...input, ...change }, now)).toThrowError();
    }
  });

  it("trims notes and rejects empty or oversized content", () => {
    expect(validatePreSessionNote("  I want to discuss sleep.\n")).toBe("I want to discuss sleep.");
    expect(() => validatePreSessionNote(" \n\t")).toThrowError();
    expect(validatePreSessionNote("a".repeat(2000))).toHaveSize(2000);
    expect(() => validatePreSessionNote("a".repeat(2001))).toThrowError();
  });
});
