import { inject, Injectable } from "@angular/core";
import { supabase } from "./supabase.client";
import { AuthService } from "./auth.service";

export interface InsightTag {
  tag: string;
  count: number;
  avg: number;
}

export interface InsightSeriesDay {
  date: string;
  avg: number | null;
  count: number;
}

export interface InsightStats {
  total_check_ins: number;
  total_journals: number;
  coverage_days: number;
  range_days: number;
  mean: number | null;
  median: number | null;
  stddev: number | null;
  slope: number | null;
  trend: "improving" | "steady" | "declining" | null;
  delta_vs_prior: number | null;
  top_tags: InsightTag[];
  series: InsightSeriesDay[];
}

export interface InsightConcern {
  source_id: string;
  date: string;
  reasons: string[];
  excerpt: string;
}

export interface InsightQuote {
  id: string;
  date: string;
  text: string;
}

export interface NarrativeSection {
  text: string;
  source_ids: string[];
}

export interface InsightNarrative {
  data_coverage: NarrativeSection;
  observed_patterns: NarrativeSection;
  client_reported_concerns: NarrativeSection;
  client_strengths: NarrativeSection;
  session_prompts: NarrativeSection;
}

export interface InsightPayload {
  generated_at: string;
  range_days: number;
  stats: InsightStats;
  concerns: InsightConcern[];
  quotes: InsightQuote[];
  narrative: InsightNarrative | null;
  narrative_error?: string;
}

/** Coded AI failures the UI turns into specific toasts. */
export class InsightError extends Error {
  constructor(
    public readonly code: "rate_limited" | "payment_required" | "unavailable",
    message: string
  ) {
    super(message);
  }
}

@Injectable({ providedIn: "root" })
export class InsightService {
  private readonly auth = inject(AuthService);
  async generate(rangeDays: 7 | 30 | 90): Promise<InsightPayload> {
    const userId = this.auth.requireUserId();
    if (![7, 30, 90].includes(rangeDays)) throw new Error("Choose a valid date range.");
    const { data, error } = await supabase.functions.invoke("siggy-insight", {
      body: { rangeDays },
    });

    this.auth.assertUser(userId);
    if (!error && data?.stats) {
      return data as InsightPayload;
    }

    const status = (error as { context?: { status?: number } } | null)?.context?.status;
    if (status === 429) {
      throw new InsightError("rate_limited", "The AI is handling a lot right now — try again in a moment.");
    }
    if (status === 402) {
      throw new InsightError("payment_required", "AI credits are exhausted. Add credits to keep generating insights.");
    }
    throw new InsightError("unavailable", "Couldn't reach SIGGY Insight. Check your connection and try again.");
  }
}
