import { QueryErrorComponent } from "../ui/query-error.component";
import { isDemoMode } from "../core/demo-session";
import { Component, computed, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import {
  Bell,
  BellRing,
  Flower2,
  LucideAngularModule,
  NotebookPen,
  Plus,
  Shield,
  SmilePlus,
  Trash2,
} from "lucide-angular";
import { ConfirmationService, MessageService } from "primeng/api";
import { ButtonModule } from "primeng/button";
import { ConfirmPopupModule } from "primeng/confirmpopup";
import { InputTextModule } from "primeng/inputtext";
import { SkeletonModule } from "primeng/skeleton";
import { ToggleSwitchModule } from "primeng/toggleswitch";
import {
  REMINDER_NOTIFICATION_BODY,
  RemindersService,
  type Reminder,
  type ReminderKind,
} from "../core/reminders.service";
import { FeedbackService } from "../core/feedback.service";
import { PageContainerComponent } from "../layout/page-container.component";

const KIND_META: Record<ReminderKind, { label: string; defaultTitle: string }> = {
  mood_check: { label: "Mood", defaultTitle: "Mood check-in" },
  journal: { label: "Journal", defaultTitle: "Journal moment" },
  meditation: { label: "Meditate", defaultTitle: "A minute to breathe" },
  custom: { label: "Custom", defaultTitle: "" },
};

const KINDS: ReminderKind[] = ["mood_check", "journal", "meditation", "custom"];
const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];

@Component({
  selector: "app-reminders",
  standalone: true,
  imports: [QueryErrorComponent,
    FormsModule,
    LucideAngularModule,
    ButtonModule,
    ConfirmPopupModule,
    InputTextModule,
    SkeletonModule,
    ToggleSwitchModule,
    PageContainerComponent,
  ],
  template: `
    <app-page-container maxWidth="md">
      <header class="animate-fade-in-up">
        <h1 class="text-3xl">Reminders</h1>
        <p class="mt-2 text-sm text-muted-foreground">
          Gentle nudges, on your schedule. Skippable, always.
        </p>
      </header>

      <section class="mt-6 animate-fade-in-up" style="animation-delay: 60ms" aria-label="Privacy">
        <div class="flex items-start gap-3 rounded-2xl border border-border/60 bg-card/60 p-4">
          <lucide-icon [img]="icons.Shield" [size]="18" class="mt-0.5 shrink-0 text-primary" />
          <div class="text-sm">
            <p class="font-medium">Private by design</p>
            <p class="mt-0.5 text-muted-foreground">
              Notifications never include what you write or how you're doing. They only say:
              "{{ notificationBody }}"
            </p>
          </div>
        </div>

        @if (demo) {
          <p class="mt-3 text-sm text-muted-foreground">Demo reminders appear inside this tab while it is open. Device notification permissions stay unchanged.</p>
        } @else if (reminders.supported && reminders.permission() !== "granted") {
          <div class="mt-3 flex flex-wrap items-center gap-3">
            <p-button
              label="Enable device notifications"
              icon="pi pi-bell"
              [outlined]="true"
              size="small"
              (onClick)="enableNotifications()"
            />
            @if (reminders.permission() === "denied") {
              <span class="text-xs text-muted-foreground">
                Blocked in your browser — you'll get in-app nudges while SIGGY is open.
              </span>
            }
          </div>
        }
      </section>

      <section class="mt-6 animate-fade-in-up" style="animation-delay: 120ms" aria-label="Your reminders">
        <div class="flex items-center justify-between">
          <h2 class="text-xl">Your reminders</h2>
          @if (!showForm()) {
            <p-button label="New" icon="pi pi-plus" size="small" (onClick)="openForm()" />
          }
        </div>

        @if (showForm()) {
          <div class="glass-card mt-3 animate-scale-in p-5">
            <p class="text-sm font-medium">What's this reminder for?</p>
            <div class="mt-2 flex flex-wrap gap-2">
              @for (kind of kinds; track kind) {
                <button type="button" (click)="setKind(kind)" [class]="kindClass(kind)">
                  {{ kindMeta[kind].label }}
                </button>
              }
            </div>

            <label class="mt-4 block text-sm font-medium" for="reminder-title">Title</label>
            <input
              pInputText
              id="reminder-title"
              class="mt-2 w-full"
              placeholder="e.g. Evening check-in"
              [ngModel]="formTitle()" [disabled]="reminders.createMutation.isPending()"
              (ngModelChange)="formTitle.set($event)"
            />

            <label class="mt-4 block text-sm font-medium" for="reminder-time">Time</label>
            <input
              pInputText
              id="reminder-time"
              type="time"
              class="mt-2 w-full"
              [ngModel]="formTime()" [disabled]="reminders.createMutation.isPending()"
              (ngModelChange)="formTime.set($event)"
            />

            <p class="mt-4 text-sm font-medium">Days</p>
            <div class="mt-2 flex gap-1.5" role="group" aria-label="Days of week">
              @for (letter of dayLetters; track $index) {
                <button
                  type="button"
                  (click)="toggleDay($index)" [disabled]="reminders.createMutation.isPending()"
                  [class]="dayChipClass($index)"
                  [attr.aria-pressed]="formDays().includes($index)"
                  [attr.aria-label]="'Toggle day ' + $index"
                >
                  {{ letter }}
                </button>
              }
            </div>

            <div class="mt-5 flex gap-2">
              <p-button
                label="Save reminder"
                styleClass="flex-1 w-full btn-glow"
                class="block flex-1"
                [disabled]="!canSave()"
                [loading]="reminders.createMutation.isPending()"
                (onClick)="save()"
              />
              <p-button label="Cancel" [text]="true" (onClick)="closeForm()" />
            </div>
          </div>
        }

        <div class="mt-3 space-y-3">
          @if (reminders.remindersQuery.isPending()) {
            @for (i of [0, 1]; track i) {
              <p-skeleton height="88px" borderRadius="1rem" />
            }
          } @else if (reminders.remindersQuery.isError()) {
            <app-query-error message="Couldn't load your reminders" (retry)="reminders.remindersQuery.refetch()" />
          } @else if (list().length === 0 && !showForm()) {
            <div class="empty-state">
              <div class="empty-state-icon">
                <lucide-icon [img]="icons.BellRing" [size]="24" />
              </div>
              <p class="font-medium">No reminders yet</p>
              <p class="max-w-xs text-sm text-muted-foreground">
                A gentle nudge at the right time can help check-ins stick.
              </p>
              <p-button label="Create one" styleClass="btn-glow mt-2" (onClick)="openForm()" />
            </div>
          } @else {
            @for (reminder of list(); track reminder.id) {
              <div class="glass-card flex items-center gap-3 p-4">
                <span
                  class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-primary-soft text-primary"
                >
                  <lucide-icon [img]="kindIcon(reminder.kind)" [size]="20" />
                </span>
                <div class="min-w-0 flex-1">
                  <p class="text-sm font-medium">{{ reminder.title }}</p>
                  <div class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span class="text-xs text-muted-foreground">
                      {{ timeDisplay(reminder.time_of_day) }}
                    </span>
                    <span class="flex gap-0.5" aria-hidden="true">
                      @for (letter of dayLetters; track $index) {
                        <span [class]="miniDayClass(reminder, $index)">{{ letter }}</span>
                      }
                    </span>
                  </div>
                </div>
                <p-toggleswitch
                  [ngModel]="reminder.enabled"
                  (ngModelChange)="toggle(reminder, $event)"
                  [attr.aria-label]="'Enable ' + reminder.title"
                />
                <button
                  type="button"
                  (click)="confirmDelete($event, reminder)"
                  class="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
                  aria-label="Delete reminder"
                >
                  <lucide-icon [img]="icons.Trash2" [size]="16" />
                </button>
              </div>
            }
          }
        </div>
      </section>
    </app-page-container>

    <p-confirmpopup />
  `,
})
export class RemindersComponent {
  readonly demo = isDemoMode();
  readonly icons = { Bell, BellRing, Shield, Trash2, Plus };
  readonly kinds = KINDS;
  readonly kindMeta = KIND_META;
  readonly dayLetters = DAY_LETTERS;
  readonly notificationBody = REMINDER_NOTIFICATION_BODY;

  readonly reminders = inject(RemindersService);
  private readonly feedback = inject(FeedbackService);
  private readonly messages = inject(MessageService);
  private readonly confirmation = inject(ConfirmationService);

  readonly showForm = signal(false);
  readonly formKind = signal<ReminderKind>("mood_check");
  readonly formTitle = signal(KIND_META.mood_check.defaultTitle);
  readonly formTime = signal("09:00");
  readonly formDays = signal<number[]>([0, 1, 2, 3, 4, 5, 6]);

  readonly list = computed(() => this.reminders.remindersQuery.data() ?? []);
  readonly canSave = computed(
    () =>
      this.formTitle().trim().length > 0 &&
      this.formTime().length >= 4 &&
      this.formDays().length > 0 &&
      !this.reminders.createMutation.isPending()
  );

  openForm() {
    this.showForm.set(true);
  }

  closeForm() {
    this.showForm.set(false);
  }

  setKind(kind: ReminderKind) {
    this.feedback.trigger("tap");
    const previousDefault = KIND_META[this.formKind()].defaultTitle;
    const current = this.formTitle().trim();
    this.formKind.set(kind);
    if (!current || current === previousDefault) {
      this.formTitle.set(KIND_META[kind].defaultTitle);
    }
  }

  toggleDay(day: number) {
    this.feedback.trigger("tap");
    this.formDays.update((days) =>
      days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort()
    );
  }

  /** Full class strings — Tailwind variant names can't live in [class.x] bindings. */
  kindClass(kind: ReminderKind): string {
    const base =
      "min-h-[44px] rounded-full border px-4 py-2 text-sm font-medium transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
    return this.formKind() === kind
      ? `${base} border-transparent bg-gradient-primary text-primary-foreground shadow-glow`
      : `${base} border-border/60 bg-card/70 hover:border-primary/40`;
  }

  dayChipClass(day: number): string {
    const base =
      "flex h-11 w-11 items-center justify-center rounded-full text-sm font-medium transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
    return this.formDays().includes(day)
      ? `${base} bg-gradient-primary text-primary-foreground shadow-glow`
      : `${base} bg-muted/60 text-muted-foreground hover:bg-accent`;
  }

  miniDayClass(reminder: Reminder, day: number): string {
    const base = "text-[10px] font-semibold";
    return reminder.days_of_week.includes(day)
      ? `${base} text-primary`
      : `${base} text-muted-foreground/40`;
  }

  kindIcon(kind: ReminderKind) {
    switch (kind) {
      case "mood_check":
        return SmilePlus;
      case "journal":
        return NotebookPen;
      case "meditation":
        return Flower2;
      default:
        return Bell;
    }
  }

  timeDisplay(time: string): string {
    const [hours, minutes] = time.split(":").map(Number);
    const period = hours >= 12 ? "PM" : "AM";
    const displayHours = hours % 12 === 0 ? 12 : hours % 12;
    return `${displayHours}:${String(minutes).padStart(2, "0")} ${period}`;
  }

  async enableNotifications() {
    const result = await this.reminders.requestPermission();
    if (result === "granted") {
      this.feedback.trigger("success");
      this.messages.add({
        severity: "success",
        summary: "Notifications on",
        detail: `They'll only ever say: "${REMINDER_NOTIFICATION_BODY}"`,
      });
    }
  }

  save() {
    if (!this.canSave()) return;
    this.reminders.createMutation.mutate(
      {
        title: this.formTitle().trim(),
        kind: this.formKind(),
        time_of_day: this.formTime(),
        days_of_week: this.formDays(),
      },
      {
        onSuccess: () => {
          this.feedback.trigger("success");
          this.messages.add({ severity: "success", summary: "Reminder saved" });
          this.showForm.set(false);
          this.formKind.set("mood_check");
          this.formTitle.set(KIND_META.mood_check.defaultTitle);
          this.formTime.set("09:00");
          this.formDays.set([0, 1, 2, 3, 4, 5, 6]);
        },
        onError: (error) => this.fail(error),
      }
    );
  }

  toggle(reminder: Reminder, enabled: boolean) {
    this.reminders.toggleMutation.mutate(
      { id: reminder.id, enabled },
      { onError: (error) => this.fail(error) }
    );
  }

  confirmDelete(event: Event, reminder: Reminder) {
    this.confirmation.confirm({
      target: event.currentTarget as EventTarget,
      message: "Delete this reminder?",
      acceptLabel: "Delete",
      rejectLabel: "Keep",
      accept: () => {
        this.reminders.deleteMutation.mutate(reminder.id, {
          onSuccess: () => this.messages.add({ severity: "success", summary: "Reminder deleted" }),
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
