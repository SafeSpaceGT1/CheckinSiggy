import { QueryErrorComponent } from "../ui/query-error.component";
import { Component, computed, inject } from "@angular/core";
import { RouterLink } from "@angular/router";
import { format, startOfWeek } from "date-fns";
import {
  CalendarDays,
  ChevronRight,
  Circle,
  CircleCheck,
  Flame,
  LucideAngularModule,
  NotebookPen,
  Shield,
  SmilePlus,
  Sparkles,
} from "lucide-angular";
import { ButtonModule } from "primeng/button";
import { SkeletonModule } from "primeng/skeleton";
import { MoodService } from "../core/mood.service";
import { JournalService } from "../core/journal.service";
import { AuthService } from "../core/auth.service";
import { TherapyService } from "../core/therapy.service";
import { RoleService } from "../core/role.service";
import { ClientsService } from "../core/clients.service";
import { computeStreaks, dayKey } from "../core/streak";
import { PageContainerComponent } from "../layout/page-container.component";

interface ActivityItem {
  id: string;
  kind: "mood" | "journal";
  emoji?: string;
  title: string;
  detail?: string;
  created_at: string;
}

const MOOD_LABELS: Record<number, string> = {
  1: "Very Sad",
  2: "Sad",
  3: "Neutral",
  4: "Good",
  5: "Great",
};

@Component({
  selector: "app-home",
  standalone: true,
  imports: [QueryErrorComponent,RouterLink, LucideAngularModule, ButtonModule, SkeletonModule, PageContainerComponent],
  template: `
    <app-page-container>
      <header class="animate-fade-in-up">
        <p class="text-sm text-muted-foreground">{{ todayLabel }}</p>
        <h1 class="mt-1 text-3xl">
          Good {{ period }}, <span class="gradient-text">{{ name() }}</span>
        </h1>
        <p class="mt-2 text-sm text-muted-foreground">{{ checkInMessage() }}</p>
      </header>

      <section class="mt-6 animate-fade-in-up" style="animation-delay: 60ms" aria-label="Quick stats">
        @if (loading()) {
          <div class="grid grid-cols-3 gap-3">
            @for (i of [0, 1, 2]; track i) {
              <p-skeleton height="96px" borderRadius="1rem" />
            }
          </div>
        } @else if (!loadError()) {
          <div class="grid grid-cols-3 gap-3">
            <div class="stat-card">
              @if (streaks().hasCheckedInToday) {
                <lucide-icon [img]="icons.CircleCheck" [size]="20" class="text-success" />
              } @else {
                <lucide-icon [img]="icons.Circle" [size]="20" class="text-muted-foreground" />
              }
              <span class="stat-value text-lg">
                {{ streaks().hasCheckedInToday ? "Done" : "Not yet" }}
              </span>
              <span class="stat-label">Today's check-in</span>
            </div>
            <div class="stat-card">
              <lucide-icon [img]="icons.Flame" [size]="20" class="text-warning" />
              <span class="stat-value">{{ streaks().currentStreak }}</span>
              <span class="stat-label">Day streak</span>
            </div>
            <div class="stat-card">
              <lucide-icon [img]="icons.NotebookPen" [size]="20" class="text-secondary" />
              <span class="stat-value">{{ journaledDays() }}</span>
              <span class="stat-label">Journaled this week</span>
            </div>
          </div>
        }
      </section>

      @if (nextSession(); as session) {
        <section class="mt-6 animate-fade-in-up" aria-label="Upcoming therapy session">
          <a routerLink="/therapy-sessions" class="card-interactive flex items-center gap-3 border border-primary/20 bg-gradient-primary-soft p-4 sm:gap-4 sm:p-5">
            <span class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-card/80 text-primary"><lucide-icon [img]="icons.CalendarDays" [size]="23" /></span>
            <span class="min-w-0 flex-1">
              <span class="block text-[11px] font-semibold uppercase tracking-wider text-primary">Your next therapy session</span>
              <span class="mt-1 block text-sm font-medium">{{ nextSessionName() }} · {{ sessionLabel(session.starts_at) }}</span>
              <span class="mt-1 block text-xs text-muted-foreground">{{ session.duration_minutes }} min · {{ timezone }} · {{ role.isClinician() ? 'Read shared pre-session notes' : 'Make space for what is on your mind' }}</span>
            </span>
            <lucide-icon [img]="icons.ChevronRight" [size]="18" class="shrink-0 text-primary" />
          </a>
        </section>
      } @else if (therapy.sessionsQuery.isError()) {
        <div class="mt-6"><app-query-error message="Couldn't load your next therapy session" (retry)="therapy.sessionsQuery.refetch()" /></div>
      }

      <section class="mt-8 animate-fade-in-up" style="animation-delay: 120ms" aria-label="Quick actions">
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          @for (tile of tiles; track tile.to) {
            <a [routerLink]="tile.to" class="card-interactive flex items-center gap-4 p-5">
              <span
                class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl"
                [class]="tile.chip"
              >
                <lucide-icon [img]="tile.icon" [size]="24" />
              </span>
              <div class="min-w-0 flex-1">
                <p class="font-medium">{{ tile.title }}</p>
                <p class="truncate text-sm text-muted-foreground">{{ tile.description }}</p>
              </div>
              <lucide-icon
                [img]="icons.ChevronRight"
                [size]="20"
                class="shrink-0 text-muted-foreground"
              />
            </a>
          }
        </div>
      </section>

      <section class="mt-8 animate-fade-in-up" style="animation-delay: 180ms" aria-label="Recent activity">
        <h2 class="text-xl">Recent activity</h2>
        <div class="mt-3 space-y-3">
          @if (loading()) {
            @for (i of [0, 1, 2]; track i) {
              <p-skeleton height="72px" borderRadius="1rem" />
            }
          } @else if (loadError()) {
            <app-query-error message="Couldn't load your activity" (retry)="moodsQuery.refetch(); journalsQuery.refetch()" />
          } @else if (recentActivity().length === 0) {
            <div class="empty-state">
              <div class="empty-state-icon">
                <lucide-icon [img]="icons.SmilePlus" [size]="24" />
              </div>
              <p class="font-medium">Nothing here yet</p>
              <p class="max-w-xs text-sm text-muted-foreground">
                Your check-ins and journal entries will show up here.
              </p>
              <a routerLink="/mood-check" class="mt-2">
                <p-button label="Make your first check-in" styleClass="btn-glow" />
              </a>
            </div>
          } @else {
            @for (item of recentActivity(); track item.id) {
              <div class="glass-card flex items-center gap-3 p-4">
                @if (item.kind === "mood") {
                  <span
                    class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-xl"
                  >
                    {{ item.emoji }}
                  </span>
                } @else {
                  <span
                    class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-primary-soft text-primary"
                  >
                    <lucide-icon [img]="icons.NotebookPen" [size]="20" />
                  </span>
                }
                <div class="min-w-0 flex-1">
                  <p class="text-sm font-medium">{{ item.title }}</p>
                  @if (item.detail) {
                    <p class="truncate text-xs text-muted-foreground">{{ item.detail }}</p>
                  }
                </div>
                <span class="shrink-0 text-xs text-muted-foreground">
                  {{ formatTime(item.created_at) }}
                </span>
              </div>
            }
          }
        </div>
      </section>
    </app-page-container>
  `,
})
export class HomeComponent {
  readonly icons = { CalendarDays, CircleCheck, Circle, Flame, NotebookPen, ChevronRight, SmilePlus };

  readonly tiles = [
    {
      to: "/mood-check",
      title: "Quick check-in",
      description: "How are you feeling right now?",
      icon: SmilePlus,
      chip: "bg-gradient-primary text-primary-foreground shadow-glow",
    },
    {
      to: "/journal",
      title: "Write a journal entry",
      description: "Capture a thought before it fades.",
      icon: NotebookPen,
      chip: "bg-gradient-primary-soft text-primary",
    },
    {
      to: "/insight",
      title: "SIGGY Insight",
      description: "Preview your session-prep summary.",
      icon: Sparkles,
      chip: "bg-gradient-primary-soft text-primary",
    },
    {
      to: "/crisis-plan",
      title: "Crisis plan",
      description: "Your plan, one tap away.",
      icon: Shield,
      chip: "bg-gradient-primary-soft text-primary",
    },
  ];

  private readonly auth = inject(AuthService);
  readonly therapy = inject(TherapyService);
  readonly role = inject(RoleService);
  private readonly clients = inject(ClientsService);
  readonly timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  readonly nextSession = computed(() => this.therapy.upcomingSessions()[0] ?? null);
  readonly nextSessionName = computed(() => {
    const session = this.nextSession();
    const connection = this.therapy.connectionsQuery.data()?.find((item) => item.id === session?.connection_id);
    return connection ? this.role.isClinician() ? this.clients.clientsById().get(connection.client_id)?.name ?? "Your client" : connection.therapist_name : "Therapy session";
  });
  sessionLabel(iso: string): string { return format(new Date(iso), "EEE, MMM d · h:mm a"); }

  readonly todayLabel = format(new Date(), "EEEE, MMMM d");
  readonly period = (() => {
    const hour = new Date().getHours();
    return hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  })();

  readonly name = computed(() => {
    const localPart = this.auth.user()?.email?.split("@")[0] ?? "there";
    return localPart.charAt(0).toUpperCase() + localPart.slice(1);
  });

  // Reuse the same complete, account-scoped history as the check-in and journal
  // pages. Saves refresh this view immediately and navigation avoids duplicate reads.
  readonly moodsQuery = inject(MoodService).entriesQuery;
  readonly journalsQuery = inject(JournalService).entriesQuery;

  readonly loadError = computed(() => this.moodsQuery.isError() || this.journalsQuery.isError());

  readonly loading = computed(() => this.moodsQuery.isPending() || this.journalsQuery.isPending());

  readonly streaks = computed(() =>
    computeStreaks((this.moodsQuery.data() ?? []).map((entry) => entry.created_at))
  );

  readonly checkInMessage = computed(() => {
    const s = this.streaks();
    if (s.hasCheckedInToday) return "Nice — you've checked in today.";
    return s.totalCheckIns > 0 ? "You can continue today." : "You can check in today.";
  });

  readonly journaledDays = computed(() => {
    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
    return new Set(
      (this.journalsQuery.data() ?? [])
        .filter((entry) => new Date(entry.created_at) >= weekStart)
        .map((entry) => dayKey(new Date(entry.created_at)))
    ).size;
  });

  readonly recentActivity = computed<ActivityItem[]>(() => {
    const moods = (this.moodsQuery.data() ?? []).map((entry) => ({
      id: `mood-${entry.id}`,
      kind: "mood" as const,
      emoji: entry.emoji,
      title: `${MOOD_LABELS[entry.value] ?? "Check-in"} check-in`,
      detail: entry.notes ?? undefined,
      created_at: entry.created_at,
    }));
    const journals = (this.journalsQuery.data() ?? []).map((entry) => ({
      id: `journal-${entry.id}`,
      kind: "journal" as const,
      emoji: undefined,
      title: "Journal entry",
      detail: entry.content,
      created_at: entry.created_at,
    }));
    return [...moods, ...journals]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 5);
  });

  formatTime(iso: string): string {
    return format(new Date(iso), "MMM d, h:mm a");
  }
}
