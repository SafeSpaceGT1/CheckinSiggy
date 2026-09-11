import { QueryErrorComponent } from "../ui/query-error.component";
import { Component, computed, inject, signal, viewChild } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { format, isToday } from "date-fns";
import {
  Bookmark,
  Flame,
  Hash,
  LucideAngularModule,
  SmilePlus,
  Trophy,
} from "lucide-angular";
import { MessageService } from "primeng/api";
import { ButtonModule } from "primeng/button";
import { SkeletonModule } from "primeng/skeleton";
import { SliderModule } from "primeng/slider";
import { TabsModule } from "primeng/tabs";
import { TextareaModule } from "primeng/textarea";
import { ToggleSwitchModule } from "primeng/toggleswitch";
import { TooltipModule } from "primeng/tooltip";
import {
  MOOD_EMOJIS,
  MOOD_LABELS,
  MoodService,
  ratingToValue,
  type MoodEntry,
  type MoodValue,
} from "../core/mood.service";
import { FeedbackService } from "../core/feedback.service";
import { PageContainerComponent } from "../layout/page-container.component";
import { ConfettiComponent } from "../ui/confetti.component";

const TAGS = [
  "Anxious",
  "Calm",
  "Stressed",
  "Hopeful",
  "Tired",
  "Energized",
  "Sad",
  "Content",
  "Angry",
  "Lonely",
  "Connected",
  "Overwhelmed",
  "Focused",
  "Restless",
  "Grateful",
] as const;

@Component({
  selector: "app-mood-check",
  standalone: true,
  imports: [QueryErrorComponent,
    FormsModule,
    LucideAngularModule,
    ButtonModule,
    SkeletonModule,
    SliderModule,
    TabsModule,
    TextareaModule,
    ToggleSwitchModule,
    TooltipModule,
    PageContainerComponent,
    ConfettiComponent,
  ],
  template: `
    <app-page-container maxWidth="md">
      <header class="animate-fade-in-up">
        <p class="text-sm text-muted-foreground">{{ todayLabel }}</p>
        <h1 class="mt-1 text-3xl">How are you feeling?</h1>
        <p class="mt-2 text-sm text-muted-foreground">{{ subtitle() }}</p>
      </header>

      <section class="mt-6 animate-fade-in-up" style="animation-delay: 60ms" aria-label="Streaks">
        @if (mood.entriesQuery.isPending()) {
          <div class="grid grid-cols-3 gap-3">
            @for (i of [0, 1, 2]; track i) {
              <p-skeleton height="96px" borderRadius="1rem" />
            }
          </div>
        } @else if (!mood.entriesQuery.isError()) {
          <div class="grid grid-cols-3 gap-3">
            <div class="stat-card">
              <lucide-icon [img]="icons.Flame" [size]="20" class="text-warning" />
              <span class="stat-value">{{ mood.streaks().currentStreak }}</span>
              <span class="stat-label">Current streak</span>
            </div>
            <div class="stat-card">
              <lucide-icon [img]="icons.Trophy" [size]="20" class="text-primary" />
              <span class="stat-value">{{ mood.streaks().bestStreak }}</span>
              <span class="stat-label">Best streak</span>
            </div>
            <div class="stat-card">
              <lucide-icon [img]="icons.Hash" [size]="20" class="text-secondary" />
              <span class="stat-value">{{ mood.streaks().totalCheckIns }}</span>
              <span class="stat-label">Total check-ins</span>
            </div>
          </div>
        }
      </section>

      <section class="mt-8 animate-fade-in-up" style="animation-delay: 120ms">
        <div class="glass-card p-5">
          <p-tabs value="quick">
            <p-tablist>
              <p-tab value="quick" class="flex-1 justify-center">Quick</p-tab>
              <p-tab value="detailed" class="flex-1 justify-center">Detailed</p-tab>
            </p-tablist>
            <p-tabpanels>
              <p-tabpanel value="quick">
                <p class="pt-2 text-sm text-muted-foreground">
                  One tap is a complete check-in.
                </p>
                <div class="mt-4 grid grid-cols-5 gap-2">
                  @for (option of moodOptions; track option.value) {
                    <button
                      type="button"
                      (click)="quick(option.value)"
                      [disabled]="mood.saveMutation.isPending()"
                      class="flex min-h-[76px] flex-col items-center justify-center gap-1 rounded-2xl border border-border/60 bg-card/70 py-3 transition-all hover:scale-105 hover:border-primary/40 hover:shadow-glow active:scale-95 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      [attr.aria-label]="'Check in as ' + option.label"
                    >
                      <span class="text-3xl leading-none">{{ option.emoji }}</span>
                      <span class="text-[11px] font-medium text-muted-foreground">
                        {{ option.label }}
                      </span>
                    </button>
                  }
                </div>
              </p-tabpanel>

              <p-tabpanel value="detailed">
                <div class="space-y-6 pt-2">
                  <div class="flex flex-col items-center gap-1 pt-2">
                    <span class="text-5xl leading-none">{{ detailedEmoji() }}</span>
                    <span class="text-sm font-medium text-muted-foreground">
                      {{ detailedLabel() }}
                    </span>
                  </div>

                  <div>
                    <div class="flex items-center justify-between">
                      <label id="rating-label" class="text-sm font-medium">
                        Rate it 1–10
                      </label>
                      <span class="font-display text-2xl">{{ rating() }}/10</span>
                    </div>
                    <div class="px-1 pb-1 pt-4">
                      <p-slider
                        [ngModel]="rating()" [disabled]="mood.saveMutation.isPending()"
                        (ngModelChange)="rating.set($event)"
                        [min]="1"
                        [max]="10"
                        [step]="1"
                        ariaLabelledBy="rating-label"
                      />
                    </div>
                  </div>

                  <div>
                    <p class="text-sm font-medium">What's present right now?</p>
                    <div class="mt-3 flex flex-wrap gap-2">
                      @for (tag of tags; track tag) {
                        <button
                          type="button"
                          (click)="toggleTag(tag)" [disabled]="mood.saveMutation.isPending()"
                          [class]="tagClass(tag)"
                          [attr.aria-pressed]="isTagSelected(tag)"
                        >
                          {{ tag }}
                        </button>
                      }
                    </div>
                  </div>

                  <div>
                    <label class="text-sm font-medium" for="mood-notes">
                      Notes <span class="font-normal text-muted-foreground">(optional)</span>
                    </label>
                    <textarea
                      pTextarea
                      id="mood-notes"
                      rows="3"
                      class="mt-2 w-full"
                      placeholder="Anything you want to remember about right now?"
                      [ngModel]="notes()" [disabled]="mood.saveMutation.isPending()"
                      (ngModelChange)="notes.set($event)"
                    ></textarea>
                  </div>

                  <div class="flex items-center justify-between gap-4 rounded-xl bg-muted/60 p-4">
                    <div>
                      <label class="text-sm font-medium" for="next-session">
                        Add this to my next session
                      </label>
                      <p class="text-xs text-muted-foreground">
                        Flag it for session prep in SIGGY Insight.
                      </p>
                    </div>
                    <p-toggleswitch
                      inputId="next-session"
                      [ngModel]="nextSession()" [disabled]="mood.saveMutation.isPending()"
                      (ngModelChange)="nextSession.set($event)"
                    />
                  </div>

                  <p-button
                    label="Save check-in"
                    styleClass="w-full btn-glow"
                    class="block w-full"
                    [loading]="mood.saveMutation.isPending()"
                    (onClick)="saveDetailed()"
                  />
                </div>
              </p-tabpanel>
            </p-tabpanels>
          </p-tabs>
        </div>
      </section>

      <section class="mt-8 animate-fade-in-up" style="animation-delay: 180ms" aria-label="Recent check-ins">
        <h2 class="text-xl">Recent check-ins</h2>
        <div class="mt-3 space-y-3">
          @if (mood.entriesQuery.isPending()) {
            @for (i of [0, 1, 2]; track i) {
              <p-skeleton height="72px" borderRadius="1rem" />
            }
          } @else if (mood.entriesQuery.isError()) {
            <app-query-error message="Couldn't load your check-ins" (retry)="mood.entriesQuery.refetch()" />
          } @else if (mood.recent().length === 0) {
            <div class="empty-state">
              <div class="empty-state-icon">
                <lucide-icon [img]="icons.SmilePlus" [size]="24" />
              </div>
              <p class="font-medium">No check-ins yet</p>
              <p class="max-w-xs text-sm text-muted-foreground">
                However you're feeling counts. Your history will build here.
              </p>
            </div>
          } @else {
            @for (entry of mood.recent(); track entry.id) {
              <div class="glass-card flex items-start gap-3 p-4">
                <span
                  class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-xl"
                >
                  {{ entry.emoji }}
                </span>
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <p class="text-sm font-medium">{{ moodLabel(entry) }}</p>
                    @if (entry.rating_10) {
                      <span
                        class="rounded-full bg-gradient-primary-soft px-2 py-0.5 text-xs font-semibold text-primary"
                      >
                        {{ entry.rating_10 }}/10
                      </span>
                    }
                    @if (entry.add_to_next_session) {
                      <lucide-icon
                        [img]="icons.Bookmark"
                        [size]="14"
                        class="text-primary"
                        pTooltip="Flagged for your next session"
                        tooltipPosition="top"
                      />
                    }
                  </div>
                  @if (entry.notes) {
                    <p class="mt-0.5 truncate text-xs text-muted-foreground">{{ entry.notes }}</p>
                  }
                  @if (entry.tags.length > 0) {
                    <div class="mt-1.5 flex flex-wrap gap-1">
                      @for (tag of entry.tags.slice(0, 3); track tag) {
                        <span
                          class="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
                        >
                          {{ tag }}
                        </span>
                      }
                      @if (entry.tags.length > 3) {
                        <span class="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                          +{{ entry.tags.length - 3 }}
                        </span>
                      }
                    </div>
                  }
                </div>
                <span class="shrink-0 pt-0.5 text-xs text-muted-foreground">
                  {{ timeLabel(entry.created_at) }}
                </span>
              </div>
            }
          }
        </div>
      </section>
    </app-page-container>

    <app-confetti />
  `,
})
export class MoodCheckComponent {
  readonly icons = { Flame, Trophy, Hash, Bookmark, SmilePlus };
  readonly tags = TAGS;

  readonly moodOptions = ([1, 2, 3, 4, 5] as MoodValue[]).map((value) => ({
    value,
    emoji: MOOD_EMOJIS[value],
    label: MOOD_LABELS[value],
  }));

  readonly mood = inject(MoodService);
  private readonly feedback = inject(FeedbackService);
  private readonly messages = inject(MessageService);

  private readonly confetti = viewChild(ConfettiComponent);

  readonly todayLabel = format(new Date(), "EEEE, MMMM d");

  private readonly saving = signal(false);
  readonly rating = signal(5);
  readonly selectedTags = signal<string[]>([]);
  readonly notes = signal("");
  readonly nextSession = signal(false);

  readonly detailedEmoji = computed(() => MOOD_EMOJIS[ratingToValue(this.rating())]);
  readonly detailedLabel = computed(() => MOOD_LABELS[ratingToValue(this.rating())]);

  readonly subtitle = computed(() => {
    const s = this.mood.streaks();
    if (s.hasCheckedInToday) return "You've checked in today — come back anytime.";
    return s.totalCheckIns > 0
      ? "You can continue today."
      : "Your first check-in starts your history.";
  });

  isTagSelected(tag: string): boolean {
    return this.selectedTags().includes(tag);
  }

  toggleTag(tag: string) {
    this.feedback.trigger("tap");
    this.selectedTags.update((current) =>
      current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag]
    );
  }

  /** Full class strings — Tailwind variant names can't live in [class.x] bindings. */
  tagClass(tag: string): string {
    const base =
      "min-h-[44px] rounded-full border px-4 py-2 text-sm font-medium transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
    return this.isTagSelected(tag)
      ? `${base} border-transparent bg-gradient-primary text-primary-foreground shadow-glow`
      : `${base} border-border/60 bg-card/70 text-foreground hover:border-primary/40`;
  }

  quick(value: MoodValue) {
    if (this.saving() || this.mood.saveMutation.isPending()) return;
    this.saving.set(true);
    this.mood.saveMutation.mutate(
      { value, emoji: MOOD_EMOJIS[value] },
      {
        onSuccess: () => this.celebrate(),
        onError: (error) => this.fail(error),
        onSettled: () => this.saving.set(false),
      }
    );
  }

  saveDetailed() {
    if (this.saving() || this.mood.saveMutation.isPending()) return;
    const rating = this.rating();
    const value = ratingToValue(rating);
    this.saving.set(true);
    this.mood.saveMutation.mutate(
      {
        value,
        emoji: MOOD_EMOJIS[value],
        rating_10: rating,
        tags: this.selectedTags(),
        notes: this.notes().trim() || null,
        add_to_next_session: this.nextSession(),
      },
      {
        onSuccess: () => {
          this.celebrate();
          this.selectedTags.set([]);
          this.notes.set("");
          this.nextSession.set(false);
        },
        onError: (error) => this.fail(error),
        onSettled: () => this.saving.set(false),
      }
    );
  }

  moodLabel(entry: MoodEntry): string {
    return `${MOOD_LABELS[entry.value] ?? "Check-in"}`;
  }

  timeLabel(iso: string): string {
    const date = new Date(iso);
    return isToday(date) ? format(date, "h:mm a") : format(date, "MMM d");
  }

  private celebrate() {
    this.confetti()?.fire();
    this.feedback.trigger("success");
    this.messages.add({
      severity: "success",
      summary: "Checked in",
      detail: "Saved to your history.",
    });
  }

  private fail(error: Error) {
    this.feedback.trigger("error");
    this.messages.add({
      severity: "error",
      summary: "Couldn't save",
      detail: error.message,
    });
  }
}
