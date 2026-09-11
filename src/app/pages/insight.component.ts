import { Component, computed, inject, signal } from "@angular/core";
import { RouterLink } from "@angular/router";
import { format } from "date-fns";
import {
  CalendarDays,
  CircleHelp,
  Copy,
  Flag,
  LucideAngularModule,
  Minus,
  RefreshCw,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-angular";
import { MessageService } from "primeng/api";
import { ButtonModule } from "primeng/button";
import { SkeletonModule } from "primeng/skeleton";
import { TooltipModule } from "primeng/tooltip";
import {
  InsightError,
  InsightService,
  type InsightConcern,
  type InsightPayload,
  type NarrativeSection,
} from "../core/insight.service";
import { FeedbackService } from "../core/feedback.service";
import { PageContainerComponent } from "../layout/page-container.component";
import { isDemoMode } from "../core/demo-session";

type RangeDays = 7 | 30 | 90;

interface NarrativeCard {
  key: string;
  title: string;
  icon: typeof Sparkles;
  section: NarrativeSection;
}

const REASON_LABELS: Record<string, string> = {
  low_rating: "Low rating",
  flagged_for_session: "Flagged for session",
  safety_language: "Contains safety language",
};

@Component({
  selector: "app-insight",
  standalone: true,
  imports: [
    RouterLink,
    LucideAngularModule,
    ButtonModule,
    SkeletonModule,
    TooltipModule,
    PageContainerComponent,
  ],
  template: `
    <app-page-container maxWidth="md">
      <header class="animate-fade-in-up">
        <h1 class="text-3xl">SIGGY <span class="gradient-text">Insight</span></h1>
        <p class="mt-2 text-sm text-muted-foreground">
          A session-prep summary built from your own check-ins and journals.
        </p>
        @if (demo) {
          <p class="mt-2 text-xs font-medium text-accent-foreground">
            Demo preview: statistics and sample reflections are calculated in this tab. No live AI.
          </p>
        }
      </header>

      <div
        class="mt-4 flex items-start gap-3 rounded-2xl border border-warning/50 bg-warning/10 p-4 animate-fade-in-up"
        role="note"
      >
        <lucide-icon [img]="icons.Flag" [size]="16" class="mt-0.5 shrink-0 text-warning" />
        <p class="text-xs leading-relaxed">
          Insight is session prep, not a clinical assessment. It never diagnoses and never
          scores risk — bring it to your therapist and decide together what matters.
        </p>
      </div>

      <section class="mt-5 flex flex-wrap items-center gap-2 animate-fade-in-up" style="animation-delay: 60ms">
        @for (option of ranges; track option) {
          <button type="button" (click)="setRange(option)" [class]="rangeChip(option)">
            {{ option }} days
          </button>
        }
        <span class="flex-1"></span>
        @if (payload()) {
          <p-button
            icon="pi pi-refresh"
            [rounded]="true"
            [text]="true"
            [loading]="loading()"
            (onClick)="generate()"
            ariaLabel="Regenerate insight"
          />
        }
      </section>

      @if (loading()) {
        <div class="mt-5 space-y-3">
          <p-skeleton height="96px" borderRadius="1rem" />
          <p-skeleton height="180px" borderRadius="1rem" />
          <p-skeleton height="140px" borderRadius="1rem" />
        </div>
      } @else if (!payload()) {
        <div class="empty-state mt-6 animate-fade-in-up">
          <div class="empty-state-icon">
            <lucide-icon [img]="icons.Sparkles" [size]="24" />
          </div>
          <p class="font-medium">Ready when you are</p>
          <p class="max-w-xs text-sm text-muted-foreground">
            SIGGY will crunch the last {{ range() }} days of check-ins and journals into
            numbers you can trust and a summary you can bring to session.
          </p>
          <p-button
            label="Generate insight"
            styleClass="btn-glow mt-2"
            [loading]="loading()"
            (onClick)="generate()"
          />
        </div>
      } @else if (payload()!.stats.total_check_ins === 0) {
        <div class="empty-state mt-6 animate-fade-in-up">
          <span class="text-3xl">🌱</span>
          <p class="font-medium">Not enough data yet</p>
          <p class="max-w-xs text-sm text-muted-foreground">
            No check-ins in the last {{ range() }} days. A few quick check-ins give Insight
            something real to work with.
          </p>
          <a routerLink="/mood-check" class="mt-2">
            <p-button label="Check in now" styleClass="btn-glow" />
          </a>
        </div>
      } @else {
        <!-- Deterministic stats -->
        <section class="mt-5 animate-fade-in-up" aria-label="Statistics">
          <div class="grid grid-cols-3 gap-3">
            <div class="stat-card">
              <lucide-icon [img]="icons.CalendarDays" [size]="20" class="text-primary" />
              <span class="stat-value">
                {{ payload()!.stats.coverage_days }}/{{ payload()!.stats.range_days }}
              </span>
              <span class="stat-label">Days checked in</span>
            </div>
            <div class="stat-card">
              <span class="font-display text-xl leading-none text-secondary">Ø</span>
              <span class="stat-value">{{ payload()!.stats.mean ?? "–" }}</span>
              <span class="stat-label">Avg rating /10</span>
            </div>
            <div class="stat-card">
              <lucide-icon [img]="trendIcon()" [size]="20" [class]="trendColor()" />
              <span class="stat-value text-lg">{{ trendLabel() }}</span>
              <span class="stat-label">
                {{ deltaLabel() }}
              </span>
            </div>
          </div>

          @if (sparkPoints()) {
            <div class="glass-card mt-3 p-4">
              <div class="flex items-baseline justify-between">
                <p class="text-sm font-medium">Daily average</p>
                <p class="text-xs text-muted-foreground">
                  median {{ payload()!.stats.median ?? "–" }}
                  @if (payload()!.stats.stddev !== null) {
                    · spread ±{{ payload()!.stats.stddev }}
                  }
                </p>
              </div>
              <svg
                viewBox="0 0 100 32"
                preserveAspectRatio="none"
                class="mt-2 h-16 w-full"
                role="img"
                aria-label="Daily average rating trend"
              >
                <line x1="0" y1="16" x2="100" y2="16" stroke="hsl(var(--border))" stroke-width="0.5" stroke-dasharray="2 2" />
                <polyline
                  [attr.points]="sparkPoints()"
                  fill="none"
                  stroke="hsl(var(--primary))"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </div>
          }

          @if (payload()!.stats.top_tags.length > 0) {
            <div class="glass-card mt-3 p-4">
              <p class="text-sm font-medium">Most-used tags</p>
              <div class="mt-2 flex flex-wrap gap-2">
                @for (tag of payload()!.stats.top_tags; track tag.tag) {
                  <span class="flex items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-xs font-medium">
                    {{ tag.tag }}
                    <span class="text-muted-foreground">×{{ tag.count }}</span>
                    <span class="rounded-full bg-gradient-primary-soft px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                      avg {{ tag.avg }}
                    </span>
                  </span>
                }
              </div>
            </div>
          }
        </section>

        <!-- For review -->
        <section class="mt-5 animate-fade-in-up" aria-label="For review">
          <div class="glass-card p-4">
            <div class="flex items-center gap-2">
              <lucide-icon [img]="icons.Flag" [size]="16" class="text-warning" />
              <h2 class="text-lg">For review with your clinician</h2>
            </div>
            @if (payload()!.concerns.length === 0) {
              <p class="mt-2 text-sm text-muted-foreground">
                Nothing flagged in this window.
              </p>
            } @else {
              <div class="mt-3 space-y-2.5">
                @for (concern of payload()!.concerns; track concern.source_id) {
                  <div class="rounded-xl bg-muted/50 p-3">
                    <div class="flex flex-wrap items-center gap-1.5">
                      <span class="text-xs text-muted-foreground">{{ dateLabel(concern.date) }}</span>
                      @for (reason of concern.reasons; track reason) {
                        <span class="badge-warning">{{ reasonLabel(reason) }}</span>
                      }
                    </div>
                    <p class="mt-1.5 text-sm">{{ concern.excerpt }}</p>
                  </div>
                }
              </div>
              @if (hasSafetyFlag()) {
                <p class="mt-3 text-xs text-muted-foreground">
                  Some entries contain safety-related language — flagged for review only, never
                  scored. Your <a routerLink="/crisis-plan" class="font-medium text-primary hover:underline">crisis plan</a>
                  is one tap away whenever you need it.
                </p>
              }
            }
          </div>
        </section>

        <!-- Narrative -->
        @if (payload()!.narrative) {
          <section class="mt-5 space-y-3" aria-label="Narrative summary">
            @for (card of narrativeCards(); track card.key) {
              <div class="glass-card animate-fade-in-up p-4">
                <div class="flex items-center gap-2">
                  <span class="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-primary-soft text-primary">
                    <lucide-icon [img]="card.icon" [size]="16" />
                  </span>
                  <h2 class="text-lg">{{ card.title }}</h2>
                </div>
                <p class="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{{ card.section.text }}</p>
                @if (card.section.source_ids.length > 0) {
                  <div class="mt-2 flex flex-wrap gap-1">
                    @for (id of card.section.source_ids; track id) {
                      <span
                        class="cursor-help rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground"
                        [pTooltip]="sourceTooltip(id)"
                        tooltipPosition="top"
                      >
                        {{ sourceIndex(id) }}
                      </span>
                    }
                  </div>
                }
              </div>
            }
          </section>
        } @else if (payload()!.narrative_error) {
          <p class="mt-4 text-xs text-muted-foreground">
            The numbers above are exact; the written summary couldn't be generated this time.
          </p>
        }

        <div class="mt-6 space-y-2 animate-fade-in-up">
          <p-button
            label="Copy session prep"
            icon="pi pi-copy"
            styleClass="w-full btn-glow"
            class="block w-full"
            (onClick)="copySessionPrep()"
          />
          <p class="text-center text-[11px] text-muted-foreground">
            Generated {{ generatedLabel() }} · paste it into notes, a message, or print it out.
          </p>
        </div>
      }
    </app-page-container>
  `,
})
export class InsightComponent {
  readonly demo = isDemoMode();
  readonly icons = { Sparkles, Flag, CalendarDays, TrendingUp, TrendingDown, Minus, Copy, RefreshCw, CircleHelp };
  readonly ranges: RangeDays[] = [7, 30, 90];

  private readonly insight = inject(InsightService);
  private readonly feedback = inject(FeedbackService);
  private readonly messages = inject(MessageService);

  readonly range = signal<RangeDays>(30);
  readonly loading = signal(false);
  readonly payload = signal<InsightPayload | null>(null);

  setRange(days: RangeDays) {
    if (this.range() === days) return;
    this.feedback.trigger("tap");
    this.range.set(days);
    if (this.payload()) {
      void this.generate();
    }
  }

  /** Full class strings — Tailwind variant names can't live in [class.x] bindings. */
  rangeChip(days: RangeDays): string {
    const base =
      "min-h-[44px] rounded-full border px-4 py-2 text-sm font-medium transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
    return this.range() === days
      ? `${base} border-transparent bg-gradient-primary text-primary-foreground shadow-glow`
      : `${base} border-border/60 bg-card/70 hover:border-primary/40`;
  }

  async generate() {
    if (this.loading()) return;
    this.loading.set(true);
    try {
      const payload = await this.insight.generate(this.range());
      this.payload.set(payload);
      this.feedback.trigger("success");
    } catch (error) {
      this.feedback.trigger("error");
      if (error instanceof InsightError) {
        this.messages.add({
          severity: error.code === "unavailable" ? "error" : "warn",
          summary:
            error.code === "rate_limited"
              ? "AI is busy"
              : error.code === "payment_required"
                ? "AI temporarily unavailable"
                : "Couldn't generate",
          detail: error.message,
        });
      } else {
        this.messages.add({ severity: "error", summary: "Couldn't generate", detail: "Please try again when your connection is available." });
      }
    } finally {
      this.loading.set(false);
    }
  }

  // ----- Stats presentation -----------------------------------------------------

  trendIcon() {
    switch (this.payload()?.stats.trend) {
      case "improving":
        return TrendingUp;
      case "declining":
        return TrendingDown;
      default:
        return Minus;
    }
  }

  trendColor(): string {
    switch (this.payload()?.stats.trend) {
      case "improving":
        return "text-success";
      case "declining":
        return "text-warning";
      default:
        return "text-muted-foreground";
    }
  }

  trendLabel(): string {
    switch (this.payload()?.stats.trend) {
      case "improving":
        return "Trending up";
      case "declining":
        return "Trending lower";
      case "steady":
        return "Steady";
      default:
        return "–";
    }
  }

  deltaLabel(): string {
    const delta = this.payload()?.stats.delta_vs_prior;
    if (delta === null || delta === undefined) return "vs prior window";
    const sign = delta > 0 ? "+" : "";
    return `${sign}${delta} vs prior`;
  }

  readonly sparkPoints = computed(() => {
    const series = this.payload()?.stats.series ?? [];
    const points = series
      .map((day, index) => ({ index, avg: day.avg }))
      .filter((point): point is { index: number; avg: number } => point.avg !== null);
    if (points.length < 2) return null;
    const lastIndex = series.length - 1 || 1;
    return points
      .map((point) => {
        const x = (point.index / lastIndex) * 100;
        const y = 30 - ((point.avg - 1) / 9) * 28;
        return `${Math.round(x * 10) / 10},${Math.round(y * 10) / 10}`;
      })
      .join(" ");
  });

  // ----- Narrative + sources ------------------------------------------------------

  readonly narrativeCards = computed<NarrativeCard[]>(() => {
    const narrative = this.payload()?.narrative;
    if (!narrative) return [];
    const cards: NarrativeCard[] = [
      { key: "data_coverage", title: "Your data, at a glance", icon: CalendarDays, section: narrative.data_coverage },
      { key: "observed_patterns", title: "Patterns worth noticing", icon: TrendingUp, section: narrative.observed_patterns },
      { key: "client_reported_concerns", title: "What you flagged", icon: Flag, section: narrative.client_reported_concerns },
      { key: "client_strengths", title: "Strengths in the data", icon: Sparkles, section: narrative.client_strengths },
      { key: "session_prompts", title: "Questions to bring", icon: CircleHelp, section: narrative.session_prompts },
    ];
    return cards.filter((card) => card.section.text.trim().length > 0);
  });

  private readonly sourceMap = computed(() => {
    const map = new Map<string, { index: number; text: string; date: string }>();
    const payload = this.payload();
    if (!payload) return map;
    let index = 1;
    for (const quote of payload.quotes) {
      map.set(quote.id, { index, text: quote.text, date: quote.date });
      index += 1;
    }
    for (const concern of payload.concerns) {
      if (!map.has(concern.source_id)) {
        map.set(concern.source_id, { index, text: concern.excerpt, date: concern.date });
        index += 1;
      }
    }
    return map;
  });

  sourceIndex(id: string): string {
    return String(this.sourceMap().get(id)?.index ?? "•");
  }

  sourceTooltip(id: string): string {
    const source = this.sourceMap().get(id);
    return source ? `${this.dateLabel(source.date)} — "${source.text}"` : "Source";
  }

  reasonLabel(reason: string): string {
    return REASON_LABELS[reason] ?? reason;
  }

  hasSafetyFlag(): boolean {
    return (this.payload()?.concerns ?? []).some((concern) =>
      concern.reasons.includes("safety_language")
    );
  }

  dateLabel(date: string): string {
    return format(new Date(`${date}T12:00:00`), "MMM d");
  }

  generatedLabel(): string {
    const generatedAt = this.payload()?.generated_at;
    return generatedAt ? format(new Date(generatedAt), "MMM d, h:mm a") : "";
  }

  // ----- SessionPrepCopy -------------------------------------------------------------

  async copySessionPrep() {
    const payload = this.payload();
    if (!payload) return;
    const stats = payload.stats;
    const lines: string[] = [
      `SIGGY Insight — session prep (last ${payload.range_days} days)`,
      ...(this.demo ? ["Sample data — local demo. No live AI."] : []),
      `Generated ${this.generatedLabel()}`,
      "",
      `Check-ins: ${stats.total_check_ins} across ${stats.coverage_days}/${stats.range_days} days · Journals: ${stats.total_journals}`,
    ];
    if (stats.mean !== null) {
      lines.push(
        `Average rating: ${stats.mean}/10 (median ${stats.median}${stats.stddev !== null ? `, spread ±${stats.stddev}` : ""})`
      );
    }
    lines.push(`Trend: ${this.trendLabel()}${stats.delta_vs_prior !== null ? ` · ${this.deltaLabel()}` : ""}`);
    if (stats.top_tags.length > 0) {
      lines.push(
        `Top tags: ${stats.top_tags.map((tag) => `${tag.tag} (×${tag.count}, avg ${tag.avg})`).join(", ")}`
      );
    }
    for (const card of this.narrativeCards()) {
      lines.push("", `## ${card.title}`, card.section.text);
    }
    lines.push("", "## For review");
    if (payload.concerns.length === 0) {
      lines.push("Nothing flagged in this window.");
    } else {
      for (const concern of payload.concerns) {
        lines.push(
          `- ${this.dateLabel(concern.date)}: ${concern.excerpt} [${concern.reasons.map((reason) => this.reasonLabel(reason)).join(", ")}]`
        );
      }
    }
    lines.push("", "Session prep from Check-In with SIGGY — not a clinical assessment.");

    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      this.feedback.trigger("success");
      this.messages.add({
        severity: "success",
        summary: "Copied",
        detail: "Session prep is on your clipboard.",
      });
    } catch {
      this.messages.add({
        severity: "error",
        summary: "Couldn't copy",
        detail: "Select and copy the text manually instead.",
      });
    }
  }
}
