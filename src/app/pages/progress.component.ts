import { Component, computed, inject, signal, viewChild, type OnDestroy } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { format, isToday } from "date-fns";
import {
  Check,
  Dumbbell,
  Flower2,
  LucideAngularModule,
  Pause,
  Play,
  Plus,
  Target,
  Trash2,
} from "lucide-angular";
import { ConfirmationService, MessageService } from "primeng/api";
import { ButtonModule } from "primeng/button";
import { ConfirmPopupModule } from "primeng/confirmpopup";
import { DialogModule } from "primeng/dialog";
import { InputTextModule } from "primeng/inputtext";
import { SkeletonModule } from "primeng/skeleton";
import { SliderModule } from "primeng/slider";
import { TabsModule } from "primeng/tabs";
import {
  goalDoneToday,
  goalWeekCount,
  MEDITATIONS,
  WellnessService,
  type ExerciseIntensity,
  type ExerciseLog,
  type MeditationItem,
  type WellnessGoal,
} from "../core/wellness.service";
import { FeedbackService } from "../core/feedback.service";
import { PageContainerComponent } from "../layout/page-container.component";
import { ConfettiComponent } from "../ui/confetti.component";
import { QueryErrorComponent } from "../ui/query-error.component";

const ACTIVITIES = ["Walk", "Run", "Yoga", "Gym", "Cycle", "Stretch", "Other"] as const;
const INTENSITIES: ExerciseIntensity[] = ["light", "moderate", "vigorous"];
const DAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];

@Component({
  selector: "app-progress",
  standalone: true,
  imports: [
    FormsModule,
    LucideAngularModule,
    ButtonModule,
    ConfirmPopupModule,
    DialogModule,
    InputTextModule,
    SkeletonModule,
    SliderModule,
    TabsModule,
    PageContainerComponent,
    ConfettiComponent,
    QueryErrorComponent,
  ],
  template: `
    <app-page-container maxWidth="md">
      <header class="animate-fade-in-up">
        <h1 class="text-3xl">Progress</h1>
        <p class="mt-2 text-sm text-muted-foreground">
          Goals, mindful minutes, and movement — this week, at your pace.
        </p>
      </header>

      <section class="mt-6 animate-fade-in-up" style="animation-delay: 60ms" aria-label="This week">
        <div class="grid grid-cols-3 gap-3">
          <div class="stat-card">
            <lucide-icon [img]="icons.Target" [size]="20" class="text-primary" />
            <span class="stat-value">{{ wellness.goalsQuery.isSuccess() ? wellness.goalsMet().met + "/" + wellness.goalsMet().total : "—" }}</span>
            <span class="stat-label">Goals met</span>
          </div>
          <div class="stat-card">
            <lucide-icon [img]="icons.Flower2" [size]="20" class="text-secondary" />
            <span class="stat-value">{{ wellness.sessionsQuery.isSuccess() ? wellness.mindfulMinutesThisWeek() : "—" }}</span>
            <span class="stat-label">Mindful min</span>
          </div>
          <div class="stat-card">
            <lucide-icon [img]="icons.Dumbbell" [size]="20" class="text-warning" />
            <span class="stat-value">{{ wellness.exerciseQuery.isSuccess() ? wellness.activeMinutesThisWeek() : "—" }}</span>
            <span class="stat-label">Active min</span>
          </div>
        </div>
      </section>

      <section class="mt-6 animate-fade-in-up" style="animation-delay: 120ms">
        <p-tabs value="goals">
          <p-tablist>
            <p-tab value="goals" class="flex-1 justify-center">Goals</p-tab>
            <p-tab value="meditate" class="flex-1 justify-center">Meditate</p-tab>
            <p-tab value="exercise" class="flex-1 justify-center">Exercise</p-tab>
          </p-tablist>
          <p-tabpanels>
            <!-- ============================== GOALS ============================== -->
            <p-tabpanel value="goals">
              <div class="space-y-3 pt-3">
                @if (!showGoalForm()) {
                  <p-button
                    label="New goal"
                    icon="pi pi-plus"
                    size="small"
                    [outlined]="true"
                    (onClick)="showGoalForm.set(true)"
                  />
                } @else {
                  <div class="glass-card animate-scale-in p-5">
                    <label class="text-sm font-medium" for="goal-title">Goal</label>
                    <input
                      pInputText
                      id="goal-title"
                      maxlength="200"
                      [disabled]="addingGoal()"
                      class="mt-2 w-full"
                      placeholder="e.g. Get outside"
                      [ngModel]="goalTitle()"
                      (ngModelChange)="goalTitle.set($event)"
                    />
                    <p class="mt-4 text-sm font-medium">Times per week</p>
                    <div class="mt-2 flex flex-wrap gap-1.5">
                      @for (n of [1, 2, 3, 4, 5, 6, 7]; track n) {
                        <button type="button" (click)="goalTarget.set(n)" [disabled]="addingGoal()" [class]="targetChipClass(n)">
                          {{ n }}
                        </button>
                      }
                    </div>
                    <div class="mt-5 flex gap-2">
                      <p-button
                        label="Add goal"
                        styleClass="flex-1 w-full btn-glow"
                        class="block flex-1"
                        [disabled]="!canAddGoal()"
                        [loading]="addingGoal()"
                        (onClick)="addGoal()"
                      />
                      <p-button label="Cancel" [text]="true" [disabled]="addingGoal()" (onClick)="showGoalForm.set(false)" />
                    </div>
                  </div>
                }

                @if (wellness.goalsQuery.isPending()) {
                  <p-skeleton height="96px" borderRadius="1rem" />
                } @else if (wellness.goalsQuery.isError()) {
                  <app-query-error message="Couldn't load your goals" (retry)="wellness.goalsQuery.refetch()" />
                } @else if (goals().length === 0 && !showGoalForm()) {
                  <div class="empty-state">
                    <div class="empty-state-icon">
                      <lucide-icon [img]="icons.Target" [size]="24" />
                    </div>
                    <p class="font-medium">No goals yet</p>
                    <p class="max-w-xs text-sm text-muted-foreground">
                      Small and repeatable beats big and vague. "A short walk, 3× a week" is a
                      great first goal.
                    </p>
                  </div>
                } @else {
                  @for (goal of goals(); track goal.id) {
                    <div class="glass-card p-4">
                      <div class="flex items-center justify-between gap-3">
                        <div class="min-w-0">
                          <p class="text-sm font-medium">{{ goal.title }}</p>
                          <p class="text-xs text-muted-foreground">
                            {{ weekCount(goal) }} of {{ goal.target_per_week }} this week
                          </p>
                        </div>
                        <div class="flex items-center gap-1.5">
                          <button type="button" (click)="toggleGoal(goal)" [class]="doneTodayClass(goal)" [disabled]="changingGoal()">
                            <lucide-icon [img]="icons.Check" [size]="16" />
                            {{ doneToday(goal) ? "Done today" : "Mark today" }}
                          </button>
                          <button
                            type="button"
                            (click)="confirmDeleteGoal($event, goal)"
                            [disabled]="changingGoal()"
                            class="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
                            aria-label="Delete goal"
                          >
                            <lucide-icon [img]="icons.Trash2" [size]="16" />
                          </button>
                        </div>
                      </div>
                      <div
                        class="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-muted"
                        role="progressbar"
                        [attr.aria-valuenow]="weekCount(goal)"
                        [attr.aria-valuemax]="goal.target_per_week"
                      >
                        <div
                          class="h-full rounded-full bg-gradient-primary transition-all duration-500"
                          [style.width.%]="goalPercent(goal)"
                        ></div>
                      </div>
                    </div>
                  }
                }
              </div>
            </p-tabpanel>

            <!-- ============================ MEDITATE ============================ -->
            <p-tabpanel value="meditate">
              @if (wellness.sessionsQuery.isError()) {
                <app-query-error message="Couldn't load your mindful minutes" (retry)="wellness.sessionsQuery.refetch()" />
              }
              <div class="grid gap-3 pt-3 sm:grid-cols-2">
                @for (item of meditations; track item.id) {
                  <div class="glass-card flex flex-col p-4">
                    <div class="flex items-center gap-3">
                      <span class="text-3xl">{{ item.emoji }}</span>
                      <div>
                        <p class="text-sm font-medium">{{ item.title }}</p>
                        <span
                          class="rounded-full bg-gradient-primary-soft px-2 py-0.5 text-[11px] font-semibold text-primary"
                        >
                          {{ item.minutes }} min
                        </span>
                      </div>
                    </div>
                    <p class="mt-2 flex-1 text-xs leading-relaxed text-muted-foreground">
                      {{ item.description }}
                    </p>
                    <p-button
                      label="Start"
                      icon="pi pi-play"
                      size="small"
                      styleClass="w-full mt-3"
                      class="mt-3 block w-full"
                      [outlined]="true"
                      [disabled]="savingMeditation()"
                      (onClick)="startMeditation(item)"
                    />
                  </div>
                }
              </div>
            </p-tabpanel>

            <!-- ============================ EXERCISE ============================ -->
            <p-tabpanel value="exercise">
              <div class="space-y-4 pt-3">
                <div class="glass-card p-5">
                  <p class="text-sm font-medium">Log movement</p>
                  <div class="mt-2 flex flex-wrap gap-2">
                    @for (activity of activities; track activity) {
                      <button type="button" (click)="setActivity(activity)" [class]="activityClass(activity)">
                        {{ activity }}
                      </button>
                    }
                  </div>
                  @if (exActivity() === "Other") {
                    <input
                      pInputText
                      class="mt-3 w-full"
                      placeholder="What did you do?"
                      aria-label="Custom activity"
                      maxlength="200"
                      [ngModel]="exCustom()"
                      (ngModelChange)="exCustom.set($event)"
                    />
                  }

                  <div class="mt-4 flex items-center justify-between">
                    <label id="minutes-label" class="text-sm font-medium">Minutes</label>
                    <span class="font-display text-2xl">{{ exMinutes() }}</span>
                  </div>
                  <div class="px-1 pb-1 pt-3">
                    <p-slider
                      [ngModel]="exMinutes()"
                      (ngModelChange)="exMinutes.set($event)"
                      [min]="5"
                      [max]="120"
                      [step]="5"
                      ariaLabelledBy="minutes-label"
                    />
                  </div>

                  <p class="mt-4 text-sm font-medium">Intensity</p>
                  <div class="mt-2 flex gap-2">
                    @for (level of intensities; track level) {
                      <button type="button" (click)="exIntensity.set(level)" [class]="intensityClass(level)">
                        {{ level }}
                      </button>
                    }
                  </div>

                  <p-button
                    label="Log it"
                    styleClass="w-full btn-glow mt-5"
                    class="mt-5 block w-full"
                    [disabled]="!canLogExercise()"
                    [loading]="savingExercise()"
                    (onClick)="logExercise()"
                  />
                </div>

                @if (wellness.exerciseQuery.isError()) {
                  <app-query-error message="Couldn't load your movement history" (retry)="wellness.exerciseQuery.refetch()" />
                } @else if (wellness.exerciseQuery.isPending()) {
                  <p-skeleton height="140px" borderRadius="1rem" />
                } @else {
                <div class="glass-card p-5">
                  <p class="text-sm font-medium">This week</p>
                  <div class="mt-3 flex h-24 items-end gap-2" aria-hidden="true">
                    @for (minutes of wellness.exerciseByDay(); track $index) {
                      <div class="flex h-full min-w-0 flex-1 flex-col items-center gap-1">
                        <div class="flex w-full min-h-0 flex-1 items-end">
                          <div
                            class="w-full rounded-t-md bg-gradient-primary transition-all duration-500"
                            [style.height.%]="barHeight(minutes)"
                          ></div>
                        </div>
                        <span [class]="dayLabelClass($index)">{{ dayLetters[$index] }}</span>
                      </div>
                    }
                  </div>
                </div>

                }

                @if (recentExercise().length > 0) {
                  <div class="space-y-2">
                    @for (log of recentExercise(); track log.id) {
                      <div class="glass-card flex items-center gap-3 p-3.5">
                        <span [class]="intensityDotClass(log.intensity)"></span>
                        <div class="min-w-0 flex-1">
                          <p class="text-sm font-medium">{{ log.activity }}</p>
                          <p class="text-xs text-muted-foreground">
                            {{ log.minutes }} min · {{ log.intensity }}
                          </p>
                        </div>
                        <span class="text-xs text-muted-foreground">{{ timeLabel(log.created_at) }}</span>
                        <button
                          type="button"
                          (click)="confirmDeleteExercise($event, log)"
                          [disabled]="deletingExercise()"
                          class="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
                          aria-label="Delete log"
                        >
                          <lucide-icon [img]="icons.Trash2" [size]="16" />
                        </button>
                      </div>
                    }
                  </div>
                }
              </div>
            </p-tabpanel>
          </p-tabpanels>
        </p-tabs>
      </section>
    </app-page-container>

    <p-dialog
      [visible]="!!activeMeditation()"
      (visibleChange)="$event ? null : closeMeditation()"
      [modal]="true"
      [closable]="!savingMeditation()"
      [closeOnEscape]="!savingMeditation()"
      [draggable]="false"
      [resizable]="false"
      [style]="{ width: 'min(92vw, 400px)' }"
      [header]="activeMeditation()?.title ?? ''"
    >
      @if (activeMeditation(); as item) {
        <div class="flex flex-col items-center gap-4 pb-2 pt-2 text-center">
          <span class="text-5xl" [class.animate-pulse-subtle]="running()">{{ item.emoji }}</span>
          <p class="font-display text-5xl tabular-nums">{{ clock() }}</p>
          <p class="max-w-xs text-sm text-muted-foreground">{{ item.description }}</p>
          <div class="flex w-full gap-2">
            <p-button
              [label]="running() ? 'Pause' : 'Resume'"
              [outlined]="true"
              styleClass="w-full"
              class="block flex-1"
              [disabled]="savingMeditation() || remaining() === 0"
              (onClick)="toggleMeditation()"
            />
            <p-button
              label="Finish"
              [loading]="savingMeditation()"
              [disabled]="savingMeditation() || remaining() === item.minutes * 60"
              styleClass="w-full btn-glow"
              class="block flex-1"
              (onClick)="finishMeditation()"
            />
          </div>
        </div>
      }
    </p-dialog>

    <p-confirmpopup />
    <app-confetti />
  `,
})
export class ProgressComponent implements OnDestroy {
  readonly icons = { Target, Flower2, Dumbbell, Check, Trash2, Plus, Play, Pause };
  readonly meditations = MEDITATIONS;
  readonly activities = ACTIVITIES;
  readonly intensities = INTENSITIES;
  readonly dayLetters = DAY_LETTERS;

  readonly wellness = inject(WellnessService);
  private readonly feedback = inject(FeedbackService);
  private readonly messages = inject(MessageService);
  private readonly confirmation = inject(ConfirmationService);

  private readonly confetti = viewChild.required(ConfettiComponent);

  // Goals
  readonly showGoalForm = signal(false);
  readonly goalTitle = signal("");
  readonly goalTarget = signal(3);
  readonly goals = computed(() => this.wellness.goalsQuery.data() ?? []);
  readonly addingGoal = signal(false);
  readonly changingGoal = signal(false);
  readonly canAddGoal = computed(() =>
    !this.addingGoal() && !this.wellness.addGoalMutation.isPending() &&
    this.goalTitle().trim().length > 0 && this.goalTitle().trim().length <= 200 &&
    Number.isInteger(this.goalTarget()) && this.goalTarget() >= 1 && this.goalTarget() <= 7
  );

  // Meditation player
  readonly activeMeditation = signal<MeditationItem | null>(null);
  readonly remaining = signal(0);
  readonly running = signal(false);
  private timer?: ReturnType<typeof setInterval>;
  private elapsedMs = 0;
  private runningSince: number | null = null;
  readonly savingMeditation = signal(false);

  // Exercise
  readonly exActivity = signal<string>("Walk");
  readonly exCustom = signal("");
  readonly exMinutes = signal(30);
  readonly exIntensity = signal<ExerciseIntensity>("moderate");
  readonly savingExercise = signal(false);
  readonly deletingExercise = signal(false);
  readonly recentExercise = computed(() =>
    (this.wellness.exerciseQuery.data() ?? []).slice(0, 6)
  );
  readonly canLogExercise = computed(() => {
    if (this.savingExercise() || this.wellness.logExerciseMutation.isPending()) return false;
    const activity = this.exActivity() === "Other" ? this.exCustom().trim() : this.exActivity();
    return ACTIVITIES.some((value) => value === this.exActivity()) &&
      activity.length > 0 && activity.length <= 200 &&
      Number.isInteger(this.exMinutes()) && this.exMinutes() >= 5 && this.exMinutes() <= 120 &&
      INTENSITIES.includes(this.exIntensity());
  });

  // ----- Goals ---------------------------------------------------------------

  weekCount = goalWeekCount;
  doneToday = goalDoneToday;

  goalPercent(goal: WellnessGoal): number {
    return Math.min(100, (goalWeekCount(goal) / goal.target_per_week) * 100);
  }

  targetChipClass(n: number): string {
    const base =
      "flex h-11 w-11 items-center justify-center rounded-full text-sm font-medium transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
    return this.goalTarget() === n
      ? `${base} bg-gradient-primary text-primary-foreground shadow-glow`
      : `${base} bg-muted/60 text-muted-foreground hover:bg-accent`;
  }

  doneTodayClass(goal: WellnessGoal): string {
    const base =
      "flex min-h-[40px] items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-medium transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
    return goalDoneToday(goal)
      ? `${base} bg-success/15 text-success`
      : `${base} bg-gradient-primary-soft text-primary hover:scale-105`;
  }

  addGoal() {
    if (!this.canAddGoal()) return;
    this.addingGoal.set(true);
    this.wellness.addGoalMutation.mutate(
      { title: this.goalTitle().trim(), target_per_week: this.goalTarget() },
      {
        onSuccess: () => {
          this.feedback.trigger("success");
          this.messages.add({ severity: "success", summary: "Goal added" });
          this.goalTitle.set("");
          this.goalTarget.set(3);
          this.showGoalForm.set(false);
        },
        onError: (error) => this.fail(error),
        onSettled: () => this.addingGoal.set(false),
      }
    );
  }

  toggleGoal(goal: WellnessGoal) {
    if (this.changingGoal()) return;
    this.changingGoal.set(true);
    const willMeetTarget =
      !goalDoneToday(goal) && goalWeekCount(goal) + 1 === goal.target_per_week;
    this.wellness.toggleGoalTodayMutation.mutate(goal, {
      onSuccess: () => {
        if (willMeetTarget) {
          this.confetti().fire();
          this.feedback.trigger("success");
          this.messages.add({
            severity: "success",
            summary: "Goal met for this week",
            detail: `"${goal.title}" — nicely done.`,
          });
        } else {
          this.feedback.trigger("tap");
        }
      },
      onError: (error) => this.fail(error),
      onSettled: () => this.changingGoal.set(false),
    });
  }

  confirmDeleteGoal(event: Event, goal: WellnessGoal) {
    this.confirmation.confirm({
      target: event.currentTarget as EventTarget,
      message: "Delete this goal?",
      acceptLabel: "Delete",
      rejectLabel: "Keep",
      accept: () => {
        if (this.changingGoal()) return;
        this.changingGoal.set(true);
        this.wellness.deleteGoalMutation.mutate(goal.id, {
          onError: (error) => this.fail(error),
          onSettled: () => this.changingGoal.set(false),
        });
      },
    });
  }

  // ----- Meditation ------------------------------------------------------------

  readonly clock = computed(() => {
    const total = this.remaining();
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  });

  startMeditation(item: MeditationItem) {
    if (this.activeMeditation() || this.savingMeditation()) return;
    this.feedback.trigger("tap");
    this.activeMeditation.set(item);
    this.elapsedMs = 0;
    this.runningSince = Date.now();
    this.remaining.set(item.minutes * 60);
    this.running.set(true);
    clearInterval(this.timer);
    this.timer = setInterval(() => {
      if (!this.running()) return;
      this.updateMeditationTime();
      if (this.remaining() === 0) this.finishMeditation();
    }, 250);
  }

  toggleMeditation() {
    if (!this.activeMeditation() || this.savingMeditation() || this.remaining() === 0) return;
    if (this.running()) {
      this.pauseMeditation();
    } else {
      this.runningSince = Date.now();
      this.running.set(true);
    }
  }

  private updateMeditationTime() {
    const item = this.activeMeditation();
    if (!item) return;
    const elapsed = this.elapsedMs + (this.runningSince === null ? 0 : Math.max(0, Date.now() - this.runningSince));
    this.remaining.set(Math.max(0, item.minutes * 60 - Math.floor(elapsed / 1000)));
  }

  private pauseMeditation() {
    if (this.runningSince !== null) {
      this.elapsedMs += Math.max(0, Date.now() - this.runningSince);
      this.runningSince = null;
    }
    this.running.set(false);
    this.updateMeditationTime();
  }

  finishMeditation() {
    const item = this.activeMeditation();
    if (!item || this.savingMeditation()) return;
    this.pauseMeditation();
    const elapsed = item.minutes * 60 - this.remaining();
    if (elapsed < 1) return;
    this.savingMeditation.set(true);
    this.wellness.logMeditationMutation.mutate(
      { item, completedSeconds: elapsed },
      {
        onSuccess: () => {
          this.savingMeditation.set(false);
          this.closeMeditation();
          this.confetti().fire(18);
          this.feedback.trigger("success");
          const minutes = Math.floor(elapsed / 60);
          const seconds = elapsed % 60;
          const duration = minutes > 0
            ? `${minutes} min${seconds ? ` ${seconds} sec` : ""}`
            : `${seconds} sec`;
          this.messages.add({
            severity: "success",
            summary: "Session logged",
            detail: `${duration} of mindful time.`,
          });
        },
        // Keep the paused session open so a failed save can be retried.
        onError: (error) => this.fail(error),
        onSettled: () => this.savingMeditation.set(false),
      }
    );
  }

  closeMeditation() {
    if (this.savingMeditation()) return;
    clearInterval(this.timer);
    this.timer = undefined;
    this.activeMeditation.set(null);
    this.running.set(false);
    this.runningSince = null;
    this.elapsedMs = 0;
  }

  ngOnDestroy() {
    clearInterval(this.timer);
  }

  // ----- Exercise ---------------------------------------------------------------

  setActivity(activity: string) {
    this.feedback.trigger("tap");
    this.exActivity.set(activity);
  }

  activityClass(activity: string): string {
    const base =
      "min-h-[44px] rounded-full border px-4 py-2 text-sm font-medium transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
    return this.exActivity() === activity
      ? `${base} border-transparent bg-gradient-primary text-primary-foreground shadow-glow`
      : `${base} border-border/60 bg-card/70 hover:border-primary/40`;
  }

  intensityClass(level: ExerciseIntensity): string {
    const base =
      "min-h-[44px] flex-1 rounded-full border px-3 py-2 text-sm font-medium capitalize transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
    return this.exIntensity() === level
      ? `${base} border-transparent bg-gradient-primary text-primary-foreground shadow-glow`
      : `${base} border-border/60 bg-card/70 hover:border-primary/40`;
  }

  intensityDotClass(level: ExerciseIntensity): string {
    const base = "h-2.5 w-2.5 shrink-0 rounded-full";
    switch (level) {
      case "light":
        return `${base} bg-secondary`;
      case "vigorous":
        return `${base} bg-warning`;
      default:
        return `${base} bg-primary`;
    }
  }

  dayLabelClass(index: number): string {
    const mondayFirstToday = (new Date().getDay() + 6) % 7;
    const base = "text-[10px] font-semibold";
    return index === mondayFirstToday ? `${base} text-primary` : `${base} text-muted-foreground`;
  }

  barHeight(minutes: number): number {
    const max = Math.max(30, ...this.wellness.exerciseByDay());
    return minutes === 0 ? 3 : Math.max(8, (minutes / max) * 100);
  }

  timeLabel(iso: string): string {
    const date = new Date(iso);
    return isToday(date) ? format(date, "h:mm a") : format(date, "MMM d");
  }

  logExercise() {
    if (!this.canLogExercise()) return;
    this.savingExercise.set(true);
    const minutes = this.exMinutes();
    const custom = this.exCustom();
    const activity = this.exActivity() === "Other" ? this.exCustom().trim() : this.exActivity();
    this.wellness.logExerciseMutation.mutate(
      { activity, minutes, intensity: this.exIntensity(), notes: null },
      {
        onSuccess: () => {
          this.feedback.trigger("success");
          this.messages.add({
            severity: "success",
            summary: "Movement logged",
            detail: `${activity} · ${minutes} min`,
          });
          if (this.exCustom() === custom) this.exCustom.set("");
        },
        onError: (error) => this.fail(error),
        onSettled: () => this.savingExercise.set(false),
      }
    );
  }

  confirmDeleteExercise(event: Event, log: ExerciseLog) {
    this.confirmation.confirm({
      target: event.currentTarget as EventTarget,
      message: "Delete this log?",
      acceptLabel: "Delete",
      rejectLabel: "Keep",
      accept: () => {
        if (this.deletingExercise()) return;
        this.deletingExercise.set(true);
        this.wellness.deleteExerciseMutation.mutate(log.id, {
          onError: (error) => this.fail(error),
          onSettled: () => this.deletingExercise.set(false),
        });
      },
    });
  }

  private fail(error: Error) {
    this.feedback.trigger("error");
    this.messages.add({ severity: "error", summary: "Something went wrong", detail: error.message });
  }
}
