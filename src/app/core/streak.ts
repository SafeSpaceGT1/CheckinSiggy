import { format, subDays } from "date-fns";

/** Local-timezone yyyy-MM-dd key for a date. */
export function dayKey(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

export interface StreakResult {
  currentStreak: number;
  bestStreak: number;
  hasCheckedInToday: boolean;
  totalCheckIns: number;
}

/**
 * Computes check-in streaks from entry timestamps (ISO strings), in the
 * user's local timezone. A gap simply means the streak can start again —
 * SIGGY never frames it as "broken".
 */
export function computeStreaks(timestamps: string[]): StreakResult {
  const today = new Date();
  const validDates = timestamps.map((timestamp) => new Date(timestamp))
    .filter((date) => Number.isFinite(date.getTime()) && date <= today);
  const days = new Set(validDates.map(dayKey));
  const hasCheckedInToday = days.has(dayKey(today));

  // Current streak: walk backwards from today, or from yesterday when today
  // is still open (so an unfinished day never zeroes the count).
  let currentStreak = 0;
  let cursor = hasCheckedInToday ? today : subDays(today, 1);
  while (days.has(dayKey(cursor))) {
    currentStreak += 1;
    cursor = subDays(cursor, 1);
  }

  // Best streak: longest consecutive run across all recorded days.
  let bestStreak = 0;
  let run = 0;
  let prev: string | null = null;
  for (const key of Array.from(days).sort()) {
    // Parse at local noon to sidestep DST edges when stepping back a day.
    const prevKey = dayKey(subDays(new Date(`${key}T12:00:00`), 1));
    run = prev === prevKey ? run + 1 : 1;
    bestStreak = Math.max(bestStreak, run);
    prev = key;
  }

  return { currentStreak, bestStreak, hasCheckedInToday, totalCheckIns: validDates.length };
}
