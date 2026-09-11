import { QueryErrorComponent } from "../ui/query-error.component";
import { Component, computed, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { format, isToday } from "date-fns";
import {
  Loader2,
  LucideAngularModule,
  NotebookPen,
  Sparkles,
  Trash2,
} from "lucide-angular";
import { ConfirmationService, MessageService } from "primeng/api";
import { ButtonModule } from "primeng/button";
import { ConfirmPopupModule } from "primeng/confirmpopup";
import { SkeletonModule } from "primeng/skeleton";
import { TextareaModule } from "primeng/textarea";
import { TooltipModule } from "primeng/tooltip";
import { MOOD_EMOJIS, MOOD_LABELS, type MoodValue } from "../core/mood.service";
import {
  JournalAiError,
  JournalService,
  type JournalEntry,
  type Sentiment,
} from "../core/journal.service";
import { FeedbackService } from "../core/feedback.service";
import { PageContainerComponent } from "../layout/page-container.component";
import { isDemoMode } from "../core/demo-session";

const CLAMP_THRESHOLD = 280;

@Component({
  selector: "app-journal",
  standalone: true,
  imports: [QueryErrorComponent,
    FormsModule,
    LucideAngularModule,
    ButtonModule,
    ConfirmPopupModule,
    SkeletonModule,
    TextareaModule,
    TooltipModule,
    PageContainerComponent,
  ],
  template: `
    <app-page-container maxWidth="md">
      <header class="animate-fade-in-up">
        <p class="text-sm text-muted-foreground">{{ todayLabel }}</p>
        <h1 class="mt-1 text-3xl">Journal</h1>
        <p class="mt-2 text-sm text-muted-foreground">
          Capture a thought before it fades. SIGGY can reflect the tone back — never a judgment.
        </p>
      </header>

      <section class="mt-6 animate-fade-in-up" style="animation-delay: 60ms" aria-label="New entry">
        <div class="glass-card p-5">
          <label class="text-sm font-medium" for="journal-draft">What's on your mind?</label>
          <textarea
            pTextarea
            id="journal-draft"
            rows="5"
            class="mt-2 w-full"
            placeholder="Write freely — this space is yours."
            [ngModel]="draft()"
            (ngModelChange)="draft.set($event)"
            [disabled]="journal.saveMutation.isPending()"
          ></textarea>

          <div class="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div class="flex items-center gap-1.5" role="group" aria-label="Mood for this entry (optional)">
              @for (option of moodOptions; track option.value) {
                <button
                  type="button"
                  (click)="toggleMood(option.emoji)" [disabled]="journal.saveMutation.isPending()"
                  [class]="moodButtonClass(option.emoji)"
                  [attr.aria-pressed]="draftMood() === option.emoji"
                  [attr.aria-label]="'Tag entry as ' + option.label"
                  [pTooltip]="option.label"
                  tooltipPosition="top"
                >
                  {{ option.emoji }}
                </button>
              }
            </div>
            <span class="text-xs text-muted-foreground">{{ wordCount() }} words</span>
          </div>

          <p-button
            label="Save entry"
            styleClass="w-full btn-glow mt-4"
            class="mt-4 block w-full"
            [disabled]="!canSave()"
            [loading]="journal.saveMutation.isPending()"
            (onClick)="save()"
          />
        </div>
      </section>

      <section class="mt-8 animate-fade-in-up" style="animation-delay: 120ms" aria-label="Entries">
        <h2 class="text-xl">Your entries</h2>
        <div class="mt-3 space-y-3">
          @if (journal.entriesQuery.isPending()) {
            @for (i of [0, 1, 2]; track i) {
              <p-skeleton height="120px" borderRadius="1rem" />
            }
          } @else if (journal.entriesQuery.isError()) {
            <app-query-error message="Couldn't load your journal" (retry)="journal.entriesQuery.refetch()" />
          } @else if (entries().length === 0) {
            <div class="empty-state">
              <div class="empty-state-icon">
                <lucide-icon [img]="icons.NotebookPen" [size]="24" />
              </div>
              <p class="font-medium">No entries yet</p>
              <p class="max-w-xs text-sm text-muted-foreground">
                A sentence is plenty. Your first entry can be about anything.
              </p>
            </div>
          } @else {
            @for (entry of entries(); track entry.id) {
              <article class="glass-card p-4">
                <div class="flex items-start justify-between gap-3">
                  <div class="flex items-center gap-2">
                    @if (entry.mood) {
                      <span
                        class="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-base"
                      >
                        {{ entry.mood }}
                      </span>
                    }
                    <span class="text-xs text-muted-foreground">
                      {{ timeLabel(entry.created_at) }}
                    </span>
                  </div>
                  <button
                    type="button"
                    (click)="confirmDelete($event, entry)"
                    class="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
                    aria-label="Delete this entry"
                  >
                    <lucide-icon [img]="icons.Trash2" [size]="16" />
                  </button>
                </div>

                <p
                  class="mt-2 whitespace-pre-wrap text-sm leading-relaxed"
                  [class.line-clamp-4]="isClamped(entry)"
                >{{ entry.content }}</p>
                @if (entry.content.length > clampThreshold) {
                  <button
                    type="button"
                    (click)="toggleExpanded(entry.id)"
                    class="mt-1 text-xs font-medium text-primary hover:underline"
                  >
                    {{ isExpanded(entry.id) ? "Show less" : "Show more" }}
                  </button>
                }

                <div class="mt-3 flex flex-wrap items-center gap-2">
                  @if (analysisFor(entry); as analysis) {
                    <span [class]="sentimentBadgeClass(analysis.sentiment)">
                      {{ analysis.sentiment }}
                    </span>
                    @if (analysis.source === "local") {
                      <span
                        class="text-[11px] text-muted-foreground"
                        [pTooltip]="localAnalysisDescription"
                        tooltipPosition="top"
                      >
                        local
                      </span>
                    }
                    @if (analysis.summary) {
                      <span class="text-xs text-muted-foreground">{{ analysis.summary }}</span>
                    }
                  } @else if (journal.analyzingIds().has(entry.id)) {
                    <span class="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <lucide-icon [img]="icons.Loader2" [size]="14" class="animate-spin" />
                      Reading the tone…
                    </span>
                  } @else {
                    <button
                      type="button"
                      (click)="analyzeExisting(entry)"
                      class="flex items-center gap-1.5 rounded-full bg-gradient-primary-soft px-3 py-1.5 text-xs font-medium text-primary transition-transform hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <lucide-icon [img]="icons.Sparkles" [size]="14" />
                      Analyze tone
                    </button>
                  }
                </div>
              </article>
            }
          }
        </div>
      </section>
    </app-page-container>

    <p-confirmpopup />
  `,
})
export class JournalComponent {
  readonly demo = isDemoMode();
  readonly localAnalysisDescription = this.demo
    ? "Demo reflection calculated locally; no live AI"
    : "Estimated on-device — AI wasn't available";
  readonly icons = { NotebookPen, Sparkles, Trash2, Loader2 };
  readonly clampThreshold = CLAMP_THRESHOLD;

  readonly moodOptions = ([1, 2, 3, 4, 5] as MoodValue[]).map((value) => ({
    value,
    emoji: MOOD_EMOJIS[value],
    label: MOOD_LABELS[value],
  }));

  readonly journal = inject(JournalService);
  private readonly feedback = inject(FeedbackService);
  private readonly messages = inject(MessageService);
  private readonly confirmation = inject(ConfirmationService);

  readonly todayLabel = format(new Date(), "EEEE, MMMM d");

  private readonly saving = signal(false);
  readonly draft = signal("");
  readonly draftMood = signal<string | null>(null);
  private readonly expandedIds = signal<ReadonlySet<string>>(new Set());

  readonly entries = computed(() => this.journal.entriesQuery.data() ?? []);
  readonly wordCount = computed(() => (this.draft().trim().match(/\S+/g) ?? []).length);
  readonly canSave = computed(
    () => this.draft().trim().length > 0 && !this.saving() && !this.journal.saveMutation.isPending()
  );

  toggleMood(emoji: string) {
    this.feedback.trigger("tap");
    this.draftMood.update((current) => (current === emoji ? null : emoji));
  }

  /** Full class strings — Tailwind variant names can't live in [class.x] bindings. */
  moodButtonClass(emoji: string): string {
    const base =
      "flex h-11 w-11 items-center justify-center rounded-full text-lg transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
    return this.draftMood() === emoji
      ? `${base} bg-gradient-primary-soft ring-2 ring-primary/60`
      : `${base} bg-muted/60 hover:bg-accent`;
  }

  sentimentBadgeClass(sentiment: Sentiment): string {
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

  analysisFor(entry: JournalEntry) {
    return this.journal.analysisByEntry().get(entry.id) ?? null;
  }

  isExpanded(entryId: string): boolean {
    return this.expandedIds().has(entryId);
  }

  isClamped(entry: JournalEntry): boolean {
    return entry.content.length > CLAMP_THRESHOLD && !this.isExpanded(entry.id);
  }

  toggleExpanded(entryId: string) {
    this.expandedIds.update((current) => {
      const next = new Set(current);
      if (next.has(entryId)) {
        next.delete(entryId);
      } else {
        next.add(entryId);
      }
      return next;
    });
  }

  timeLabel(iso: string): string {
    const date = new Date(iso);
    return isToday(date) ? format(date, "'Today,' h:mm a") : format(date, "MMM d, h:mm a");
  }

  save() {
    const content = this.draft().trim();
    if (!this.canSave()) return;
    this.saving.set(true);
    this.journal.saveMutation.mutate(
      { content, mood: this.draftMood() },
      {
        onSuccess: (entryId) => {
          this.feedback.trigger("success");
          this.messages.add({
            severity: "success",
            summary: "Entry saved",
            detail: "It's in your journal.",
          });
          this.draft.set("");
          this.draftMood.set(null);
          void this.runAnalysis(entryId);
        },
        onError: (error) => this.fail(error),
        onSettled: () => this.saving.set(false),
      }
    );
  }

  analyzeExisting(entry: JournalEntry) {
    void this.runAnalysis(entry.id);
  }

  private async runAnalysis(entryId: string) {
    try {
      const source = await this.journal.analyze(entryId);
      if (source === "local") {
        this.messages.add({
          severity: "info",
          summary: "Reflected locally",
          detail: this.demo
            ? "Demo reflection calculated locally. No live AI was used."
            : "AI wasn't available, so SIGGY made a light on-device read of the tone.",
        });
      }
    } catch (error) {
      if (error instanceof JournalAiError) {
        this.messages.add({
          severity: "warn",
          summary: error.code === "rate_limited" ? "AI is busy" : "AI temporarily unavailable",
          detail:
            error.code === "rate_limited"
              ? "Try analyzing again in a moment."
              : "Please try again later or contact your SIGGY administrator.",
        });
        return;
      }
      this.fail(error as Error);
    }
  }

  confirmDelete(event: Event, entry: JournalEntry) {
    if (this.journal.deleteMutation.isPending()) return;
    this.confirmation.confirm({
      target: event.currentTarget as EventTarget,
      message: "Delete this entry? This can't be undone.",
      acceptLabel: "Delete",
      rejectLabel: "Keep",
      accept: () => {
        this.journal.deleteMutation.mutate(entry.id, {
          onSuccess: () => {
            this.feedback.trigger("tap");
            this.messages.add({ severity: "success", summary: "Entry deleted" });
          },
          onError: (error) => this.fail(error),
        });
      },
    });
  }

  private fail(error: Error) {
    this.feedback.trigger("error");
    this.messages.add({ severity: "error", summary: "Something went wrong", detail: error.message });
  }
}
