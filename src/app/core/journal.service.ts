import { computed, inject, Injectable, signal } from "@angular/core";
import {
  injectMutation,
  injectQuery,
  QueryClient,
} from "@tanstack/angular-query-experimental";
import { supabase } from "./supabase.client";
import { AuthService } from "./auth.service";
import { localSentiment, type Sentiment } from "./sentiment-local";
import { optionalText, requiredText } from "./data-validation";

export type { Sentiment };

export interface JournalEntry {
  id: string;
  content: string;
  mood: string | null;
  created_at: string;
  updated_at: string;
}

export interface SentimentAnalysis {
  id: string;
  journal_entry_id: string;
  sentiment: Sentiment;
  confidence: number;
  summary: string | null;
  keywords: string[];
  source: "ai" | "local";
  created_at: string;
}

/** Coded AI failures the UI turns into specific toasts. */
export class JournalAiError extends Error {
  constructor(public readonly code: "rate_limited" | "payment_required") {
    super(code);
  }
}

@Injectable({ providedIn: "root" })
export class JournalService {
  private readonly auth = inject(AuthService);
  private readonly queryClient = inject(QueryClient);

  readonly entriesQuery = injectQuery(() => ({
    queryKey: ["journal-entries", this.auth.user()?.id],
    enabled: !!this.auth.user(),
    queryFn: async ({ queryKey, signal }): Promise<JournalEntry[]> => {
      const ownerId = queryKey[queryKey.length - 1] as string;
      this.auth.assertUser(ownerId);
      const { data, error } = await supabase
        .from("journal_entries")
        .select("id, content, mood, created_at, updated_at")
        .eq("user_id", ownerId)
        .abortSignal(signal)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw new Error(error.message);
      this.auth.assertUser(ownerId);
      return (data ?? []) as JournalEntry[];
    },
  }));

  readonly analysesQuery = injectQuery(() => ({
    queryKey: ["sentiment-analyses", this.auth.user()?.id],
    enabled: !!this.auth.user(),
    queryFn: async ({ queryKey, signal }): Promise<SentimentAnalysis[]> => {
      const ownerId = queryKey[queryKey.length - 1] as string;
      this.auth.assertUser(ownerId);
      const { data, error } = await supabase
        .from("sentiment_analyses")
        .select("id, journal_entry_id, sentiment, confidence, summary, keywords, source, created_at")
        .eq("user_id", ownerId)
        .abortSignal(signal)
        .order("created_at", { ascending: false })
        .limit(400);
      if (error) throw new Error(error.message);
      this.auth.assertUser(ownerId);
      return (data ?? []) as SentimentAnalysis[];
    },
  }));

  readonly analysisByEntry = computed(() => {
    const map = new Map<string, SentimentAnalysis>();
    for (const analysis of this.analysesQuery.data() ?? []) {
      if (!map.has(analysis.journal_entry_id)) {
        map.set(analysis.journal_entry_id, analysis);
      }
    }
    return map;
  });

  /** Entry ids currently being analyzed (drives per-card spinners). */
  readonly analyzingIds = signal<ReadonlySet<string>>(new Set());

  readonly saveMutation = injectMutation(() => ({
    mutationFn: async (payload: { content: string; mood: string | null }): Promise<string> => {
      const userId = this.auth.user()?.id;
      if (!userId) throw new Error("You need to be signed in to journal.");
      const { data, error } = await supabase
        .from("journal_entries")
        .insert({ user_id: userId, content: requiredText(payload.content, "Journal entry", 50000), mood: optionalText(payload.mood, "Mood", 40) })
        .select("id, content, mood, created_at, updated_at")
        .single();
      if (error) throw new Error(error.message);
      this.auth.assertUser(userId);
      if (!data?.id) throw new Error("The saved entry was not returned. Please refresh your journal.");
      // The save callback may analyze immediately, before the refetch completes.
      this.queryClient.setQueryData<JournalEntry[]>(["journal-entries", userId], (entries = []) =>
        [data as JournalEntry, ...entries.filter((entry) => entry.id !== data.id)]
      );
      return data.id as string;
    },
    onSuccess: () => {
      this.queryClient.invalidateQueries({ queryKey: ["journal-entries", this.auth.user()?.id] });
      this.queryClient.invalidateQueries({ queryKey: ["home-journals", this.auth.user()?.id] });
    },
  }));

  readonly deleteMutation = injectMutation(() => ({
    mutationFn: async (entryId: string) => {
      const userId = this.auth.requireUserId();
      const { data, error } = await supabase.from("journal_entries").delete()
        .eq("id", entryId).eq("user_id", userId).select("id").single();
      if (error) throw new Error(error.message);
      if (!data) throw new Error("Entry not found.");
      this.auth.assertUser(userId);
    },
    onSuccess: () => Promise.all([
      this.queryClient.invalidateQueries({ queryKey: ["journal-entries", this.auth.user()?.id] }),
      this.queryClient.invalidateQueries({ queryKey: ["home-journals", this.auth.user()?.id] }),
      this.queryClient.invalidateQueries({ queryKey: ["sentiment-analyses", this.auth.user()?.id] }),
    ]),
  }));

  /**
   * Analyze one entry. Tries the edge function first (AI); on rate/credit
   * errors it throws a coded error, on anything else (no key, offline) it
   * falls back to the on-device heuristic. Returns which path ran.
   */
  async analyze(entryId: string): Promise<"ai" | "local"> {
    const userId = this.auth.requireUserId();
    if (this.analyzingIds().has(entryId)) throw new Error("This entry is already being analyzed.");
    const entry = (this.queryClient.getQueryData<JournalEntry[]>(["journal-entries", userId]) ?? [])
      .find((candidate) => candidate.id === entryId);
    this.setAnalyzing(entryId, true);
    try {
      const { data, error } = await supabase.functions.invoke("analyze-sentiment", {
        body: { entryId },
      });

      this.auth.assertUser(userId);
      if (!error && data?.analysis) {
        this.invalidateAnalyses();
        return "ai";
      }

      const status = (error as { context?: { status?: number } } | null)?.context?.status;
      if (status === 429) throw new JournalAiError("rate_limited");
      if (status === 402) throw new JournalAiError("payment_required");

      if (status === 401 || status === 403 || status === 404) {
        throw new Error("This entry is unavailable. Please refresh your journal.");
      }
      await this.analyzeLocally(entryId, userId, entry);
      return "local";
    } finally {
      this.setAnalyzing(entryId, false);
    }
  }

  private async analyzeLocally(entryId: string, userId: string, entry: JournalEntry | undefined) {
    this.auth.assertUser(userId);
    if (!entry || !userId) throw new Error("Entry not found.");

    const result = localSentiment(entry.content);
    const { error } = await supabase.from("sentiment_analyses").upsert(
      {
        journal_entry_id: entryId,
        user_id: userId,
        sentiment: result.sentiment,
        confidence: result.confidence,
        summary: result.summary,
        keywords: result.keywords,
        source: "local",
      },
      { onConflict: "journal_entry_id" }
    );
    if (error) throw new Error(error.message);
    this.auth.assertUser(userId);
    this.invalidateAnalyses();
  }

  private invalidateAnalyses() {
    return this.queryClient.invalidateQueries({ queryKey: ["sentiment-analyses", this.auth.user()?.id] });
  }

  private setAnalyzing(entryId: string, active: boolean) {
    this.analyzingIds.update((current) => {
      const next = new Set(current);
      if (active) {
        next.add(entryId);
      } else {
        next.delete(entryId);
      }
      return next;
    });
  }
}
