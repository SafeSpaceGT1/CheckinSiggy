import { Component, computed, inject, input, output, signal } from "@angular/core";
import { LucideAngularModule, Phone, X } from "lucide-angular";
import { ButtonModule } from "primeng/button";
import { FeedbackService } from "../core/feedback.service";
import {
  EMERGENCY_DISCLAIMER,
  telHref,
  type PlanBundle,
} from "../core/crisis-plan.service";
import { BreathingRingComponent } from "./breathing-ring.component";

interface FlowItem {
  primary: string;
  secondary?: string | null;
  phone?: string | null;
}

interface FlowStep {
  kind: "pause" | "list" | "contacts" | "final";
  title: string;
  subtitle?: string;
  items?: FlowItem[];
}

/**
 * Crisis flow mode: the plan, one calm step at a time, in Stanley-Brown
 * order. Full-screen, big text, tap-to-call. Empty sections are skipped.
 */
@Component({
  selector: "app-crisis-flow",
  standalone: true,
  imports: [LucideAngularModule, ButtonModule, BreathingRingComponent],
  template: `
    <div class="fixed inset-0 z-50 overflow-y-auto bg-background">
      <div class="mx-auto flex min-h-full w-full max-w-md flex-col px-4 pb-10 pt-4">
        <div class="flex items-center justify-between">
          <div class="flex gap-1.5" aria-hidden="true">
            @for (step of steps(); track $index) {
              <span [class]="dotClass($index)"></span>
            }
          </div>
          <button
            type="button"
            (click)="closed.emit()"
            class="flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Close crisis support"
          >
            <lucide-icon [img]="icons.X" [size]="20" />
          </button>
        </div>

        <div class="flex flex-1 flex-col justify-center py-6">
          @switch (current().kind) {
            @case ("pause") {
              <div class="animate-fade-in text-center">
                <h1 class="text-3xl">{{ current().title }}</h1>
                <p class="mt-2 text-sm text-muted-foreground">
                  Stay here as long as you need. The next steps will wait.
                </p>
                <app-breathing-ring />
              </div>
            }
            @case ("list") {
              <div class="animate-fade-in">
                <h1 class="text-3xl">{{ current().title }}</h1>
                @if (current().subtitle) {
                  <p class="mt-2 text-sm text-muted-foreground">{{ current().subtitle }}</p>
                }
                <ul class="mt-6 space-y-3">
                  @for (item of current().items; track $index) {
                    <li class="glass-card flex gap-3 p-4 text-base">
                      <span class="mt-2 h-2 w-2 shrink-0 rounded-full bg-gradient-primary"></span>
                      {{ item.primary }}
                    </li>
                  }
                </ul>
              </div>
            }
            @case ("contacts") {
              <div class="animate-fade-in">
                <h1 class="text-3xl">{{ current().title }}</h1>
                @if (current().subtitle) {
                  <p class="mt-2 text-sm text-muted-foreground">{{ current().subtitle }}</p>
                }
                <div class="mt-6 space-y-3">
                  @for (item of current().items; track $index) {
                    <div class="glass-card flex items-center gap-3 p-4">
                      <div class="min-w-0 flex-1">
                        <p class="text-base font-medium">{{ item.primary }}</p>
                        @if (item.secondary) {
                          <p class="text-sm text-muted-foreground">{{ item.secondary }}</p>
                        }
                      </div>
                      @if (item.phone) {
                        <a
                          [href]="tel(item.phone)"
                          class="flex min-h-[48px] items-center gap-2 rounded-full bg-success px-5 py-2.5 text-sm font-semibold text-success-foreground shadow-soft transition-transform hover:scale-105 active:scale-95"
                          [attr.aria-label]="'Call ' + item.primary"
                        >
                          <lucide-icon [img]="icons.Phone" [size]="18" />
                          Call
                        </a>
                      }
                    </div>
                  }
                </div>
              </div>
            }
            @case ("final") {
              <div class="animate-fade-in text-center">
                <span class="text-4xl">🫂</span>
                <h1 class="mt-3 text-3xl">{{ current().title }}</h1>
                <p class="mt-3 text-sm leading-relaxed text-muted-foreground">
                  {{ disclaimer }}
                </p>
                <div class="mt-6 grid gap-2">
                  <a [href]="'tel:911'" [class]="emergencyButton">
                    <lucide-icon [img]="icons.Phone" [size]="18" />
                    Call 911 (US)
                  </a>
                  <a [href]="'tel:999'" [class]="emergencyButton">
                    <lucide-icon [img]="icons.Phone" [size]="18" />
                    Call 999 (UK)
                  </a>
                  <a [href]="'tel:988'" [class]="lifelineButton">
                    <lucide-icon [img]="icons.Phone" [size]="18" />
                    988 Suicide & Crisis Lifeline (US)
                  </a>
                </div>
                <p class="mt-4 text-xs text-muted-foreground">
                  You can restart this flow anytime from your crisis plan.
                </p>
              </div>
            }
          }
        </div>

        <div class="flex items-center justify-between gap-3">
          <p-button label="Back" [text]="true" [disabled]="index() === 0" (onClick)="back()" />
          @if (index() < steps().length - 1) {
            <p-button label="Next" styleClass="btn-glow px-8" (onClick)="next()" />
          } @else {
            <p-button label="Done" styleClass="btn-glow px-8" (onClick)="closed.emit()" />
          }
        </div>
      </div>
    </div>
  `,
})
export class CrisisFlowComponent {
  readonly icons = { Phone, X };
  readonly disclaimer = EMERGENCY_DISCLAIMER;

  readonly bundle = input.required<PlanBundle>();
  readonly closed = output<void>();

  readonly index = signal(0);
  private readonly feedback = inject(FeedbackService);

  readonly emergencyButton =
    "flex min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-destructive px-5 text-base font-semibold text-destructive-foreground shadow-lg transition-transform hover:scale-[1.02] active:scale-95";
  readonly lifelineButton =
    "flex min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-gradient-primary px-5 text-base font-semibold text-primary-foreground shadow-glow transition-transform hover:scale-[1.02] active:scale-95";

  readonly steps = computed<FlowStep[]>(() => {
    const bundle = this.bundle();
    const steps: FlowStep[] = [
      { kind: "pause", title: "Let's slow down first" },
    ];
    if (bundle.warningSigns.length > 0) {
      steps.push({
        kind: "list",
        title: "Warning signs",
        subtitle: "Sound familiar? That's the signal to use this plan — you already are.",
        items: bundle.warningSigns.map((item) => ({ primary: item.text })),
      });
    }
    if (bundle.copingStrategies.length > 0) {
      steps.push({
        kind: "list",
        title: "Things I can do myself",
        subtitle: "Try one. Small counts.",
        items: bundle.copingStrategies.map((item) => ({ primary: item.text })),
      });
    }
    if (bundle.distractions.length > 0) {
      steps.push({
        kind: "contacts",
        title: "People & places for distraction",
        subtitle: "A change of company or scenery can loosen the moment.",
        items: bundle.distractions.map((item) => ({
          primary: item.name,
          secondary: item.kind === "place" ? "Place" : "Person",
          phone: item.phone,
        })),
      });
    }
    if (bundle.supportContacts.length > 0) {
      steps.push({
        kind: "contacts",
        title: "People I can ask for help",
        subtitle: "Reaching out is part of the plan, not a failure of it.",
        items: bundle.supportContacts.map((item) => ({
          primary: item.name,
          secondary: item.relationship,
          phone: item.phone,
        })),
      });
    }
    if (bundle.professionalContacts.length > 0) {
      steps.push({
        kind: "contacts",
        title: "Professionals & agencies",
        subtitle: "Trained support, for exactly this.",
        items: bundle.professionalContacts.map((item) => ({
          primary: item.name,
          secondary: item.organization,
          phone: item.phone,
        })),
      });
    }
    if (bundle.reasonsForLiving.length > 0) {
      steps.push({
        kind: "list",
        title: "Worth remembering",
        subtitle: "Your reasons, in your words.",
        items: bundle.reasonsForLiving.map((item) => ({ primary: item.text })),
      });
    }
    if (bundle.safetySteps.length > 0) {
      steps.push({
        kind: "list",
        title: "Making my space safer",
        subtitle: "Small changes that lower the temperature.",
        items: bundle.safetySteps.map((item) => ({ primary: item.text })),
      });
    }
    steps.push({ kind: "final", title: "You're not doing this alone" });
    return steps;
  });

  readonly current = computed(() => this.steps()[this.index()]);

  dotClass(i: number): string {
    return i === this.index()
      ? "h-1.5 w-5 rounded-full bg-gradient-primary transition-all"
      : "h-1.5 w-1.5 rounded-full bg-muted transition-all";
  }

  tel(phone: string): string {
    return telHref(phone);
  }

  next() {
    this.feedback.trigger("tap");
    this.index.update((value) => Math.min(value + 1, this.steps().length - 1));
  }

  back() {
    this.feedback.trigger("tap");
    this.index.update((value) => Math.max(0, value - 1));
  }
}
