// Exact safety keyword list from the product brief. Matches flag an item
// "for review" — they are never scored, ranked, or interpreted.
const SAFETY_KEYWORDS = [
  "suicide",
  "suicidal",
  "kill myself",
  "end it",
  "self-harm",
  "hurt myself",
  "cutting",
  "can't go on",
  "want to die",
  "hopeless",
];

const FORBIDDEN = /diagnos\w*|disorder|clinical|\brisk\s*(score|level)\b/i;

export interface MoodRow {
  id: string;
  value: number;
  emoji: string;
  notes: string | null;
  rating_10: number | null;
  tags: string[];
  add_to_next_session: boolean;
  created_at: string;
}

export interface JournalRow {
  id: string;
  content: string;
  created_at: string;
}

export interface Quote {
  id: string;
  date: string;
  text: string;
}

export interface Concern {
  source_id: string;
  date: string;
  reasons: string[];
  excerpt: string;
}

const rating = (row: MoodRow) => row.rating_10 ?? row.value * 2;
const dayOf = (iso: string) => iso.slice(0, 10);
const round1 = (n: number) => Math.round(n * 10) / 10;
const clip = (text: string, max = 180) => text.replace(/\s+/g, " ").trim().slice(0, max);

function hasSafetyKeyword(text: string | null): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return SAFETY_KEYWORDS.some((keyword) => lower.includes(keyword));
}

export function computeStats(moods: MoodRow[], priorMoods: MoodRow[], rangeDays: number, startDate: Date) {
  const ratings = moods.map(rating);
  const total = ratings.length;

  const byDay = new Map<string, { sum: number; count: number }>();
  for (const row of moods) {
    const key = dayOf(row.created_at);
    const bucket = byDay.get(key) ?? { sum: 0, count: 0 };
    bucket.sum += rating(row);
    bucket.count += 1;
    byDay.set(key, bucket);
  }

  const series: { date: string; avg: number | null; count: number }[] = [];
  for (let i = 0; i < rangeDays; i += 1) {
    const date = new Date(startDate.getTime() + i * 86_400_000).toISOString().slice(0, 10);
    const bucket = byDay.get(date);
    series.push({
      date,
      avg: bucket ? round1(bucket.sum / bucket.count) : null,
      count: bucket?.count ?? 0,
    });
  }

  let mean: number | null = null;
  let median: number | null = null;
  let stddev: number | null = null;
  if (total > 0) {
    mean = ratings.reduce((sum, r) => sum + r, 0) / total;
    const sorted = [...ratings].sort((a, b) => a - b);
    median =
      total % 2 === 1
        ? sorted[(total - 1) / 2]
        : (sorted[total / 2 - 1] + sorted[total / 2]) / 2;
    if (total > 1) {
      const variance =
        ratings.reduce((sum, r) => sum + (r - (mean as number)) ** 2, 0) / (total - 1);
      stddev = round1(Math.sqrt(variance));
    }
    mean = round1(mean);
    median = round1(median);
  }

  // Trend: least-squares slope over daily averages (day index → avg).
  const points = series
    .map((day, index) => ({ x: index, y: day.avg }))
    .filter((point): point is { x: number; y: number } => point.y !== null);
  let slope: number | null = null;
  let trend: "improving" | "steady" | "declining" | null = null;
  if (points.length >= 2) {
    const n = points.length;
    const sumX = points.reduce((sum, point) => sum + point.x, 0);
    const sumY = points.reduce((sum, point) => sum + point.y, 0);
    const sumXY = points.reduce((sum, point) => sum + point.x * point.y, 0);
    const sumXX = points.reduce((sum, point) => sum + point.x * point.x, 0);
    const denominator = n * sumXX - sumX * sumX;
    if (denominator !== 0) {
      slope = (n * sumXY - sumX * sumY) / denominator;
      trend = slope > 0.05 ? "improving" : slope < -0.05 ? "declining" : "steady";
      slope = Math.round(slope * 1000) / 1000;
    }
  }

  let deltaVsPrior: number | null = null;
  if (priorMoods.length > 0 && mean !== null) {
    const priorMean = priorMoods.reduce((sum, row) => sum + rating(row), 0) / priorMoods.length;
    deltaVsPrior = round1(ratings.reduce((sum, value) => sum + value, 0) / total - priorMean);
  }

  const tagMap = new Map<string, { count: number; sum: number }>();
  for (const row of moods) {
    for (const tag of row.tags ?? []) {
      const bucket = tagMap.get(tag) ?? { count: 0, sum: 0 };
      bucket.count += 1;
      bucket.sum += rating(row);
      tagMap.set(tag, bucket);
    }
  }
  const topTags = [...tagMap.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5)
    .map(([tag, bucket]) => ({ tag, count: bucket.count, avg: round1(bucket.sum / bucket.count) }));

  return {
    total_check_ins: total,
    coverage_days: byDay.size,
    range_days: rangeDays,
    mean,
    median,
    stddev,
    slope,
    trend,
    delta_vs_prior: deltaVsPrior,
    top_tags: topTags,
    series,
  };
}

export function computeConcerns(moods: MoodRow[], journals: JournalRow[]): Concern[] {
  const concerns: Concern[] = [];
  for (const row of moods) {
    const reasons: string[] = [];
    if (rating(row) <= 4) reasons.push("low_rating");
    if (row.add_to_next_session) reasons.push("flagged_for_session");
    if (hasSafetyKeyword(row.notes)) reasons.push("safety_language");
    if (reasons.length === 0) continue;
    concerns.push({
      source_id: `m:${row.id}`,
      date: dayOf(row.created_at),
      reasons,
      excerpt: clip(row.notes ?? `${row.emoji} rated ${rating(row)}/10`),
    });
  }
  for (const row of journals) {
    if (!hasSafetyKeyword(row.content)) continue;
    concerns.push({
      source_id: `j:${row.id}`,
      date: dayOf(row.created_at),
      reasons: ["safety_language"],
      excerpt: clip(row.content),
    });
  }
  return concerns.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
}

export function buildQuotes(moods: MoodRow[], journals: JournalRow[], concerns: Concern[]): Quote[] {
  const concernIds = new Set(concerns.map((concern) => concern.source_id));
  const candidates: (Quote & { priority: number })[] = [];
  for (const row of moods) {
    if (!row.notes?.trim()) continue;
    const id = `m:${row.id}`;
    candidates.push({
      id,
      date: dayOf(row.created_at),
      text: clip(row.notes),
      priority: concernIds.has(id) ? 0 : row.add_to_next_session ? 1 : 2,
    });
  }
  for (const row of journals) {
    if (!row.content.trim()) continue;
    const id = `j:${row.id}`;
    candidates.push({
      id,
      date: dayOf(row.created_at),
      text: clip(row.content),
      priority: concernIds.has(id) ? 0 : 2,
    });
  }
  return candidates
    .sort((a, b) => a.priority - b.priority || b.date.localeCompare(a.date))
    .slice(0, 8)
    .map(({ id, date, text }) => ({ id, date, text }));
}

const SECTION_KEYS = [
  "data_coverage",
  "observed_patterns",
  "client_reported_concerns",
  "client_strengths",
  "session_prompts",
] as const;

export function sanitizeNarrative(
  args: Record<string, unknown>,
  allowedIds: Set<string>
): Record<string, { text: string; source_ids: string[] }> | null {
  if (!args || typeof args !== "object" || Array.isArray(args)) return null;
  const narrative: Record<string, { text: string; source_ids: string[] }> = {};
  let hasText = false;
  for (const key of SECTION_KEYS) {
    const section = args[key] as { text?: unknown; source_ids?: unknown } | null;
    if (!section || typeof section !== "object" || typeof section.text !== "string"
      || !Array.isArray(section.source_ids)) return null;
    // Do not silently remove fabricated citations while preserving the claim.
    if (section.source_ids.some((id) => typeof id !== "string" || !allowedIds.has(id))) return null;
    let text = section.text.trim().slice(0, 700);
    if (FORBIDDEN.test(text)) text = "";
    const sourceIds = Array.isArray(section.source_ids)
      ? section.source_ids.map(String).filter((id) => allowedIds.has(id)).slice(0, 8)
      : [];
    if (text) hasText = true;
    narrative[key] = { text, source_ids: sourceIds };
  }
  return hasText ? narrative : null;
}

export function insightRange(rangeDays: number, now: Date) {
  // Match the chart's UTC day buckets and include today in all N-day windows.
  const end = new Date(now);
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - rangeDays + 1);
  const priorStart = new Date(start.getTime() - rangeDays * 86_400_000);
  return { start, priorStart, end };
}
