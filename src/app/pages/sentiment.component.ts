import { QueryErrorComponent } from "../ui/query-error.component";
import { Component, computed, inject, signal } from "@angular/core";
import { RouterLink } from "@angular/router";
import { format } from "date-fns";
import { HeartPulse, Loader2, LucideAngularModule, NotebookPen, Sparkles } from "lucide-angular";
import { MessageService } from "primeng/api";
import { ButtonModule } from "primeng/button";
import { SkeletonModule } from "primeng/skeleton";
import { supabase } from "../core/supabase.client";
import { JournalService, type Sentiment } from "../core/journal.service";
import { localSentiment } from "../core/sentiment-local";
import { FeedbackService } from "../core/feedback.service";
import { PageContainerComponent } from "../layout/page-container.component";

interface HistoryAnalysis {
  overall: string;
  themes: string[];
  observations: string[];
  encouragement: string;
}

const SENTIMENT_ORDER: Sentiment[] = ["positive", "mixed", "neutral", "negative"];

@Component({
  selector: "app-sentiment",
  standalone: true,
  imports: [QueryErrorComponent,
    RouterLink,
    LucideAngularModule,
    ButtonModule,
    SkeletonModule,
    PageContainerComponent,
  ],
  template: `
    <app-page-container maxWidth="md">
      <header class="animate-fade-in-up">
        <h1 class="text-3xl">Sentiment</h1>
        <p class="mt-2 text-sm text-muted-foreground">
          How your journal has been reading lately. Supportive reflections — never diagnoses or
          clinical assessments.
        </p>
      </header>

      @if (journal.entriesQuery.isPending()) {
        <div class="mt-6 space-y-3">
          <p-skeleton height="120px" borderRadius="1rem" />
          <p-skeleton height="200px" borderRadius="1rem" />
        </div>
      } @else if (journal.entriesQuery.isError() || journal.analysesQuery.isError()) {
            <app-query-error message="Couldn't load your reflections" (retry)="journal.entriesQuery.refetch(); journal.analysesQuery.refetch()" />
          } @else if (totalEntries() === 0) {
        <div class="empty-state mt-8 animate-fade-in-up">
          <div class="empty-state-icon">
            <lucide-icon [img]="icons.NotebookPen" [size]="24" />
          </div>
          <p class="font-medium">Nothing to reflect on yet</p>
          <p class="max-w-xs text-sm text-muted-foreground">
            Write a journal entry or two, then come back — SIGGY will read the tone across them.
          </p>
          <a routerLink="/journal" class="mt-2">
            <p-button label="Write your first entry" styleClass="btn-glow" />
          </a>
        </div>
      } @else {
        <section class="mt-6 animate-fade-in-up" style="animation-delay: 60ms" aria-label="Tone distribution">
          <div class="glass-card p-5">
            <div class="flex items-baseline justify-between">
              <h2 class="text-lg">Tone so far</h2>
              <span class="text-xs text-muted-foreground">
                {{ counts().total }} of {{ totalEntries() }} entries analyzed
              </span>
            </div>

            @if (counts().total === 0) {
              <p class="mt-3 text-sm text-muted-foreground">
                No entries analyzed yet — tap "Analyze tone" on an entry in your journal.
              </p>
            } @else {
              <div
                class="mt-4 flex h-3 w-full overflow-hidden rounded-full bg-muted"
                role="img"
                [attr.aria-label]="distributionLabel()"
              >
                @for (segment of segments(); track segment.sentiment) {
                  <div [class]="segment.barClass" [style.width.%]="segment.percent"></div>
                }
              </div>
              <div class="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
                @for (segment of segments(); track segment.sentiment) {
                  <span class="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span [class]="segment.dotClass"></span>
                    <span class="capitalize">{{ segment.sentiment }}</span>
                    · {{ segment.count }}
                  </span>
                }
              </div>
            }
          </div>
        </section>

        <section class="mt-6 animate-fade-in-up" style="animation-delay: 120ms" aria-label="Reflection">
          <div class="glass-card p-5">
            <div class="flex items-center gap-2">
              <span
                class="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-primary-soft text-primary"
              >
                <lucide-icon [img]="icons.Sparkles" [size]="18" />
              </span>
              <h2 class="text-lg">Reflect on recent entries</h2>
            </div>
            <p class="mt-2 text-sm text-muted-foreground">
              A short, gentle read across your last {{ reflectWindow }} entries.
            </p>

            <p-button
              [label]="history() ? 'Reflect again' : 'Reflect now'"
              styleClass="w-full mt-4"
              class="mt-4 block w-full"
              [outlined]="!!history()"
              [loading]="historyLoading()"
              (onClick)="reflect()"
            />

            @if (history(); as result) {
              <div class="mt-5 space-y-4 border-t border-border/60 pt-4 animate-fade-in">
                <p class="text-sm leading-relaxed">{{ result.overall }}</p>

                @if (result.themes.length > 0) {
                  <div class="flex flex-wrap gap-1.5">
                    @for (theme of result.themes; track theme) {
                      <span
                        class="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground"
                      >
                        {{ theme }}
                      </span>
                    }
                  </div>
                }

                @for (note of result.observations; track note) {
                  <p class="flex gap-2 text-sm text-muted-foreground">
                    <span class="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gradient-primary"></span>
                    {{ note }}
                  </p>
                }

                <p class="rounded-xl bg-gradient-primary-soft p-3 text-sm text-accent-foreground">
                  {{ result.encouragement }}
                </p>

                <div class="flex items-center justify-between">
                  @if (historySource() === "local") {
                    <span class="text-[11px] text-muted-foreground">
                      Estimated on-device — AI wasn't available.
                    </span>
                  } @else {
                    <span></span>
                  }
                  <span class="badge-warning">Not a clinical assessment</span>
                </div>
              </div>
            }
          </div>
        </section>

        <section class="mt-6 animate-fade-in-up" style="animation-delay: 180ms" aria-label="Analyzed entries">
          <h2 class="text-xl">Recently analyzed</h2>
          <div class="mt-3 space-y-3">
            @if (analyzedRows().length === 0) {
              <p class="text-sm text-muted-foreground">
                Analyzed entries will show up here with their tone.
              </p>
            } @else {
              @for (row of analyzedRows(); track row.entryId) {
                <div class="glass-card flex items-start gap-3 p-4">
                  <span
                    class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-primary-soft text-primary"
                  >
                    <lucide-icon [img]="icons.HeartPulse" [size]="16" />
                  </span>
                  <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center gap-2">
                      <span [class]="badgeClass(row.sentiment)">{{ row.sentiment }}</span>
                      <span class="text-xs text-muted-foreground">{{ row.date }}</span>
                      @if (row.source === "local") {
                        <span class="text-[11px] text-muted-foreground">local</span>
                      }
                    </div>
                    @if (row.summary) {
                      <p class="mt-1 text-sm text-muted-foreground">{{ row.summary }}</p>
                    }
                    @if (row.keywords.length > 0) {
                      <div class="mt-1.5 flex flex-wrap gap-1">
                        @for (keyword of row.keywords; track keyword) {
                          <span
                            class="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
                          >
                            {{ keyword }}
                          </span>
                        }
                      </div>
                    }
                  </div>
                </div>
              }
            }
          </div>
        </section>
      }
    </app-page-container>
  `,
})
export class SentimentComponent {
  readonly icons = { HeartPulse, Sparkles, NotebookPen, Loader2 };
  readonly reflectWindow = 30;

  readonly journal = inject(JournalService);
  private readonly feedback = inject(FeedbackService);
  private readonly messages = inject(MessageService);

  readonly history = signal<HistoryAnalysis | null>(null);
  readonly historySource = signal<"ai" | "local" | null>(null);
  readonly historyLoading = signal(false);

  readonly totalEntries = computed(() => (this.journal.entriesQuery.data() ?? []).length);

  readonly counts = computed(() => {
    const tally: Record<Sentiment, number> = { positive: 0, mixed: 0, neutral: 0, negative: 0 };
    for (const analysis of this.journal.analysesQuery.data() ?? []) {
      tally[analysis.sentiment] += 1;
    }
    const total = SENTIMENT_ORDER.reduce((sum, key) => sum + tally[key], 0);
    return { ...tally, total };
  });

  readonly segments = computed(() => {
    const counts = this.counts();
    if (counts.total === 0) return [];
    return SENTIMENT_ORDER.filter((sentiment) => counts[sentiment] > 0).map((sentiment) => ({
      sentiment,
      count: counts[sentiment],
      percent: (counts[sentiment] / counts.total) * 100,
      barClass: `h-full ${BAR_CLASSES[sentiment]}`,
      dotClass: `h-2 w-2 rounded-full ${BAR_CLASSES[sentiment]}`,
    }));
  });

  readonly distributionLabel = computed(() => {
    const counts = this.counts();
    return SENTIMENT_ORDER.map((sentiment) => `${counts[sentiment]} ${sentiment}`).join(", ");
  });

  readonly analyzedRows = computed(() => {
    const entriesById = new Map(
      (this.journal.entriesQuery.data() ?? []).map((entry) => [entry.id, entry])
    );
    return (this.journal.analysesQuery.data() ?? [])
      .filter((analysis) => entriesById.has(analysis.journal_entry_id))
      .slice(0, 8)
      .map((analysis) => ({
        entryId: analysis.journal_entry_id,
        sentiment: analysis.sentiment,
        summary: analysis.summary,
        keywords: analysis.keywords.slice(0, 4),
        source: analysis.source,
        date: format(
          new Date(entriesById.get(analysis.journal_entry_id)!.created_at),
          "MMM d"
        ),
      }));
  });

  badgeClass(sentiment: Sentiment): string {
    const base =
      "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize";
    switch (sentiment) {
      case "positive":
        return `${base} bg-success/15 text-success`;
      case "negative":
        return `${base} bg-destructive/10 text-destructive`;
      case "mixed":
        return `${base} bg-warning/15 text-warning-foreground dark:text-warning`;
      default:
        return `${base} bg-muted text-muted-foreground`;
    }
  }

  async reflect() {
    if (this.historyLoading()) return;
    this.historyLoading.set(true);
    try {
      const { data, error } = await supabase.functions.invoke("analyze-journal-history", {
        body: { limit: this.reflectWindow },
      });

      if (!error && data?.analysis) {
        this.history.set(data.analysis as HistoryAnalysis);
        this.historySource.set("ai");
        this.feedback.trigger("success");
        return;
      }
      if (!error && data?.empty) {
        this.messages.add({
          severity: "info",
          summary: "Nothing to reflect on yet",
          detail: "Write an entry or two first.",
        });
        return;
      }

      const status = (error as { context?: { status?: number } } | null)?.context?.status;
      if (status === 429) {
        this.messages.add({
          severity: "warn",
          summary: "AI is busy",
          detail: "Try reflecting again in a moment.",
        });
        return;
      }
      if (status === 402) {
        this.messages.add({
          severity: "warn",
          summary: "AI temporarily unavailable",
          detail: "Please try again later or contact your SIGGY administrator.",
        });
        return;
      }

      this.reflectLocally();
    } catch {
      this.reflectLocally();
    } finally {
      this.historyLoading.set(false);
    }
  }

  /** On-device fallback: distribution sentence + keyword themes. Never clinical. */
  private reflectLocally() {
    const entries = (this.journal.entriesQuery.data() ?? []).slice(0, 10);
    if (entries.length === 0) return;

    const combined = entries.map((entry) => entry.content).join("\n");
    const local = localSentiment(combined);
    const counts = this.counts();
    const dominant =
      counts.total > 0
        ? SENTIMENT_ORDER.reduce((best, key) => (counts[key] > counts[best] ? key : best))
        : local.sentiment;

    this.history.set({
      overall: `Across your last ${entries.length} entries, the tone has leaned ${dominant}.`,
      themes: local.keywords,
      observations: [],
      encouragement: "Keep writing — patterns get clearer with a few more entries.",
    });
    this.historySource.set("local");
    this.messages.add({
      severity: "info",
      summary: "Reflected locally",
      detail: "AI wasn't available, so this is a light on-device read.",
    });
  }
}

const BAR_CLASSES: Record<Sentiment, string> = {
  positive: "bg-success",
  mixed: "bg-warning",
  neutral: "bg-muted-foreground/40",
  negative: "bg-destructive",
};
