import { computed, inject, Injectable } from "@angular/core";
import {
  injectMutation,
  injectQuery,
  QueryClient,
} from "@tanstack/angular-query-experimental";
import { supabase } from "./supabase.client";
import { AuthService } from "./auth.service";
import { computeStreaks } from "./streak";
import { integerInRange, optionalText, requiredText } from "./data-validation";

export type MoodValue = 1 | 2 | 3 | 4 | 5;

export interface MoodEntry {
  id: string;
  value: MoodValue;
  emoji: string;
  notes: string | null;
  rating_10: number | null;
  tags: string[];
  add_to_next_session: boolean;
  created_at: string;
}

export interface NewMoodEntry {
  value: MoodValue;
  emoji: string;
  notes?: string | null;
  rating_10?: number | null;
  tags?: string[];
  add_to_next_session?: boolean;
}

export const MOOD_EMOJIS: Record<MoodValue, string> = {
  1: "😢",
  2: "🙁",
  3: "😐",
  4: "🙂",
  5: "😄",
};

export const MOOD_LABELS: Record<MoodValue, string> = {
  1: "Very Sad",
  2: "Sad",
  3: "Neutral",
  4: "Good",
  5: "Great",
};

/** Detailed 1-10 ratings map onto the 1-5 scale so both kinds share one history. */
export function ratingToValue(rating: number): MoodValue {
  integerInRange(rating, 1, 10, "Mood rating");
  return Math.round(rating / 2) as MoodValue;
}

@Injectable({ providedIn: "root" })
export class MoodService {
  private readonly auth = inject(AuthService);
  private readonly queryClient = inject(QueryClient);

  /**
   * Load complete history in pages so multiple entries in one day do not
   * truncate streaks or total check-ins at the database row limit.
   */
  readonly entriesQuery = injectQuery(() => ({
    queryKey: ["mood-entries", this.auth.user()?.id],
    enabled: !!this.auth.user(),
    queryFn: async ({ queryKey, signal }): Promise<MoodEntry[]> => {
      const ownerId = queryKey[queryKey.length - 1] as string;
      this.auth.assertUser(ownerId);
      const entries: MoodEntry[] = [];
      const pageSize = 500;
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await supabase
          .from("mood_entries")
          .select("id, value, emoji, notes, rating_10, tags, add_to_next_session, created_at")
          .eq("user_id", ownerId)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, from + pageSize - 1)
          .abortSignal(signal);
        if (error) throw new Error(error.message);
        this.auth.assertUser(ownerId);
        entries.push(...((data ?? []) as MoodEntry[]));
        if (!data || data.length < pageSize) return entries;
      }
    },
  }));

  readonly streaks = computed(() =>
    computeStreaks((this.entriesQuery.data() ?? []).map((entry) => entry.created_at))
  );

  readonly recent = computed(() => (this.entriesQuery.data() ?? []).slice(0, 10));

  readonly saveMutation = injectMutation(() => ({
    mutationFn: async (payload: NewMoodEntry) => {
      const userId = this.auth.user()?.id;
      if (!userId) throw new Error("You need to be signed in to check in.");
      integerInRange(payload.value, 1, 5, "Mood");
      if (payload.rating_10 != null) integerInRange(payload.rating_10, 1, 10, "Mood rating");
      const tags = payload.tags ?? [];
      if (!Array.isArray(tags) || tags.length > 20) throw new Error("Choose up to 20 tags.");
      const { error } = await supabase.from("mood_entries").insert({
        user_id: userId,
        value: payload.value,
        emoji: MOOD_EMOJIS[payload.value],
        notes: optionalText(payload.notes, "Notes", 10000),
        rating_10: payload.rating_10 ?? null,
        tags: [...new Set(tags.map((tag) => requiredText(tag, "Tag", 80)))],
        add_to_next_session: payload.add_to_next_session ?? false,
      });
      if (error) throw new Error(error.message);
      this.auth.assertUser(userId);
      return userId;
    },
    onSuccess: (userId) => Promise.all([
      this.queryClient.invalidateQueries({ queryKey: ["mood-entries", userId] }),
      this.queryClient.invalidateQueries({ queryKey: ["home-moods", userId] }),
    ]),
  }));
}
