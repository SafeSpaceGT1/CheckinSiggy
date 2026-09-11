import { QueryErrorComponent } from "../ui/query-error.component";
import { Component, computed, inject, signal } from "@angular/core";
import { RouterLink } from "@angular/router";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight, LucideAngularModule, NotebookPen } from "lucide-angular";
import { ButtonModule } from "primeng/button";
import { SkeletonModule } from "primeng/skeleton";
import { MoodService, MOOD_LABELS } from "../core/mood.service";
import { JournalService } from "../core/journal.service";
import { TherapyService } from "../core/therapy.service";
import { RoleService } from "../core/role.service";
import { ClientsService } from "../core/clients.service";
import { dayKey } from "../core/streak";
import { PageContainerComponent } from "../layout/page-container.component";

interface CalendarCell {
  key: string;
  dayNumber: number;
  inMonth: boolean;
  today: boolean;
  hasMood: boolean;
  hasJournal: boolean;
  hasSession: boolean;
}

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

@Component({
  selector: "app-calendar",
  standalone: true,
  imports: [QueryErrorComponent,RouterLink,LucideAngularModule, ButtonModule, SkeletonModule, PageContainerComponent],
  template: `
    <app-page-container maxWidth="md">
      <header class="animate-fade-in-up">
        <h1 class="text-3xl">Calendar</h1>
        <p class="mt-2 text-sm text-muted-foreground">
          Dots mark check-ins, journal entries, and therapy sessions. Tap a day to revisit it.
        </p>
      </header>

      <section class="glass-card mt-6 animate-fade-in-up p-4" style="animation-delay: 60ms" aria-label="Month">
        <div class="flex items-center justify-between">
          <button type="button" (click)="shiftMonth(-1)" [class]="navButton" aria-label="Previous month">
            <lucide-icon [img]="icons.ChevronLeft" [size]="18" />
          </button>
          <div class="text-center">
            <p class="font-display text-lg leading-tight">{{ monthLabel() }}</p>
            @if (!viewingCurrentMonth()) {
              <button
                type="button"
                (click)="goToday()"
                class="text-xs font-medium text-primary hover:underline"
              >
                Back to today
              </button>
            }
          </div>
          <button type="button" (click)="shiftMonth(1)" [class]="navButton" aria-label="Next month">
            <lucide-icon [img]="icons.ChevronRight" [size]="18" />
          </button>
        </div>

        <div class="mt-4 grid grid-cols-7 gap-1 text-center" aria-hidden="true">
          @for (label of weekdays; track $index) {
            <span class="text-[11px] font-semibold uppercase text-muted-foreground">{{ label }}</span>
          }
        </div>

        @if (loading()) {
          <p-skeleton height="240px" borderRadius="0.75rem" styleClass="mt-2" />
        } @else if (mood.entriesQuery.isError() || journal.entriesQuery.isError()) {
          <app-query-error message="Couldn't load your calendar" (retry)="mood.entriesQuery.refetch(); journal.entriesQuery.refetch()" />
        } @else {
          <div class="mt-1 grid grid-cols-7 gap-1">
            @for (cell of cells(); track cell.key) {
              <button
                type="button"
                (click)="select(cell)"
                [class]="cellClass(cell)"
                [attr.aria-label]="ariaFor(cell)"
                [attr.aria-pressed]="selectedKey() === cell.key"
              >
                <span class="text-sm">{{ cell.dayNumber }}</span>
                <span class="flex h-1.5 items-center gap-0.5">
                  @if (cell.hasMood) {
                    <span class="h-1.5 w-1.5 rounded-full bg-primary"></span>
                  }
                  @if (cell.hasJournal) {
                    <span class="h-1.5 w-1.5 rounded-full bg-secondary"></span>
                  }
                  @if (cell.hasSession) {
                    <span class="h-1.5 w-1.5 rounded-full bg-amber-500"></span>
                  }
                </span>
              </button>
            }
          </div>
          <div class="mt-3 flex justify-center gap-4">
            <span class="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span class="h-1.5 w-1.5 rounded-full bg-primary"></span> Check-in
            </span>
            <span class="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span class="h-1.5 w-1.5 rounded-full bg-secondary"></span> Journal
            </span>
            <span class="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span class="h-1.5 w-1.5 rounded-full bg-amber-500"></span> Session
            </span>
          </div>
        }
      </section>

      <section class="mt-6 animate-fade-in-up" style="animation-delay: 120ms" aria-label="Selected day">
        <h2 class="text-xl">{{ selectedLabel() }}</h2>
        <div class="mt-3 space-y-3">
          @if (therapy.sessionsQuery.isError()) { <app-query-error message="Couldn't load therapy sessions" (retry)="therapy.sessionsQuery.refetch()" /> }
          @for (session of daySessions(); track session.id) {
            <a routerLink="/therapy-sessions" class="card-interactive flex items-center gap-3 border border-primary/20 p-4">
              <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-primary-soft text-primary"><lucide-icon [img]="icons.CalendarDays" [size]="20" /></span>
              <span class="min-w-0 flex-1"><span class="block text-sm font-medium">Therapy with {{ sessionName(session.connection_id) }}</span><span class="mt-1 block text-xs text-muted-foreground">{{ timeOf(session.starts_at) }} · {{ session.duration_minutes }} min · {{ timezone }} · {{ session.status === 'cancelled' ? 'Cancelled' : 'View session' }}</span></span>
              <lucide-icon [img]="icons.ChevronRight" [size]="17" class="shrink-0 text-primary" />
            </a>
          }
          @if (!loading() && !mood.entriesQuery.isError() && !journal.entriesQuery.isError() && !therapy.sessionsQuery.isError() && !therapy.sessionsQuery.isPending() && dayMoods().length === 0 && dayJournals().length === 0 && daySessions().length === 0) {
            <p class="text-sm text-muted-foreground">Nothing recorded on this day.</p>
          }
          @for (entry of dayMoods(); track entry.id) {
            <div class="glass-card flex items-center gap-3 p-4">
              <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-xl">
                {{ entry.emoji }}
              </span>
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <p class="text-sm font-medium">{{ moodLabel(entry.value) }}</p>
                  @if (entry.rating_10) {
                    <span class="rounded-full bg-gradient-primary-soft px-2 py-0.5 text-xs font-semibold text-primary">
                      {{ entry.rating_10 }}/10
                    </span>
                  }
                </div>
                @if (entry.notes) {
                  <p class="mt-0.5 truncate text-xs text-muted-foreground">{{ entry.notes }}</p>
                }
              </div>
              <span class="shrink-0 text-xs text-muted-foreground">{{ timeOf(entry.created_at) }}</span>
            </div>
          }
          @for (entry of dayJournals(); track entry.id) {
            <div class="glass-card flex items-start gap-3 p-4">
              <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-primary-soft text-primary">
                <lucide-icon [img]="icons.NotebookPen" [size]="18" />
              </span>
              <div class="min-w-0 flex-1">
                <p class="line-clamp-3 whitespace-pre-wrap text-sm leading-relaxed">{{ entry.content }}</p>
              </div>
              <span class="shrink-0 text-xs text-muted-foreground">{{ timeOf(entry.created_at) }}</span>
            </div>
          }
        </div>
      </section>
    </app-page-container>
  `,
})
export class CalendarComponent {
  readonly icons = { CalendarDays, ChevronLeft, ChevronRight, NotebookPen };
  readonly weekdays = WEEKDAYS;

  readonly mood = inject(MoodService);
  readonly journal = inject(JournalService);
  readonly therapy = inject(TherapyService);
  private readonly role = inject(RoleService);
  private readonly clients = inject(ClientsService);
  readonly timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  readonly daySessions = computed(() => (this.therapy.sessionsQuery.data() ?? []).filter((session) => dayKey(new Date(session.starts_at)) === this.selectedKey()).sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at)));
  private readonly sessionDays = computed(() => new Set((this.therapy.sessionsQuery.data() ?? []).filter((session) => session.status !== "cancelled").map((session) => dayKey(new Date(session.starts_at)))));
  sessionName(id: string): string {
    const connection = this.therapy.connectionsQuery.data()?.find((item) => item.id === id);
    return connection ? this.role.isClinician() ? this.clients.clientsById().get(connection.client_id)?.name ?? "your client" : connection.therapist_name : "your care connection";
  }

  readonly monthCursor = signal(startOfMonth(new Date()));
  readonly selectedKey = signal(dayKey(new Date()));

  readonly navButton =
    "flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  readonly loading = computed(
    () => this.mood.entriesQuery.isPending() || this.journal.entriesQuery.isPending()
  );

  private readonly moodDays = computed(() => {
    const days = new Set<string>();
    for (const entry of this.mood.entriesQuery.data() ?? []) {
      days.add(dayKey(new Date(entry.created_at)));
    }
    return days;
  });

  private readonly journalDays = computed(() => {
    const days = new Set<string>();
    for (const entry of this.journal.entriesQuery.data() ?? []) {
      days.add(dayKey(new Date(entry.created_at)));
    }
    return days;
  });

  readonly cells = computed<CalendarCell[]>(() => {
    const month = this.monthCursor();
    const start = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end }).map((date) => {
      const key = dayKey(date);
      return {
        key,
        dayNumber: date.getDate(),
        inMonth: isSameMonth(date, month),
        today: isToday(date),
        hasMood: this.moodDays().has(key),
        hasJournal: this.journalDays().has(key),
        hasSession: this.sessionDays().has(key),
      };
    });
  });

  readonly monthLabel = computed(() => format(this.monthCursor(), "MMMM yyyy"));
  readonly viewingCurrentMonth = computed(() =>
    isSameMonth(this.monthCursor(), new Date())
  );
  readonly selectedLabel = computed(() =>
    format(new Date(`${this.selectedKey()}T12:00:00`), "EEEE, MMMM d")
  );

  readonly dayMoods = computed(() =>
    (this.mood.entriesQuery.data() ?? []).filter(
      (entry) => dayKey(new Date(entry.created_at)) === this.selectedKey()
    )
  );

  readonly dayJournals = computed(() =>
    (this.journal.entriesQuery.data() ?? []).filter(
      (entry) => dayKey(new Date(entry.created_at)) === this.selectedKey()
    )
  );

  shiftMonth(offset: number) {
    this.monthCursor.update((current) => addMonths(current, offset));
  }

  goToday() {
    this.monthCursor.set(startOfMonth(new Date()));
    this.selectedKey.set(dayKey(new Date()));
  }

  select(cell: CalendarCell) {
    this.selectedKey.set(cell.key);
  }

  /** Full class strings — Tailwind variant names can't live in [class.x] bindings. */
  cellClass(cell: CalendarCell): string {
    const base =
      "flex aspect-square min-h-[44px] flex-col items-center justify-center gap-0.5 rounded-xl transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
    const selected = this.selectedKey() === cell.key;
    if (selected) {
      return `${base} bg-gradient-primary text-primary-foreground shadow-glow`;
    }
    const tone = cell.inMonth ? "text-foreground hover:bg-muted" : "text-muted-foreground/40 hover:bg-muted/50";
    const todayRing = cell.today ? " ring-1 ring-primary/60" : "";
    return `${base} ${tone}${todayRing}`;
  }

  ariaFor(cell: CalendarCell): string {
    const extras = [
      cell.hasMood ? "has check-in" : null,
      cell.hasJournal ? "has journal entry" : null,
      cell.hasSession ? "has therapy session" : null,
    ].filter(Boolean);
    return `${format(new Date(`${cell.key}T12:00:00`), "MMMM d")}${extras.length ? ", " + extras.join(", ") : ""}`;
  }

  moodLabel(value: number): string {
    return MOOD_LABELS[value as 1 | 2 | 3 | 4 | 5] ?? "Check-in";
  }

  timeOf(iso: string): string {
    return format(new Date(iso), "h:mm a");
  }
}
