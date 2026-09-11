import { Component, computed, inject, signal } from "@angular/core";
import { ButtonModule } from "primeng/button";
import { FeedbackService } from "../core/feedback.service";

interface GroundingStep {
  count: number;
  sense: string;
  prompt: string;
  emoji: string;
}

/** 5-4-3-2-1 grounding: five senses, counted down, no rush. */
const STEPS: GroundingStep[] = [
  { count: 5, sense: "see", emoji: "👀", prompt: "Name five things you can see around you." },
  { count: 4, sense: "feel", emoji: "🖐️", prompt: "Notice four things you can feel — fabric, air, the ground." },
  { count: 3, sense: "hear", emoji: "👂", prompt: "Listen for three sounds, near or far." },
  { count: 2, sense: "smell", emoji: "👃", prompt: "Find two things you can smell." },
  { count: 1, sense: "taste", emoji: "👅", prompt: "Notice one thing you can taste." },
];

@Component({
  selector: "app-grounding-steps",
  standalone: true,
  imports: [ButtonModule],
  template: `
    <div class="flex flex-col items-center gap-5 py-4 text-center" aria-live="polite">
      @if (!done()) {
        <div class="flex flex-col items-center gap-3 animate-fade-in-up" [attr.data-step]="index()">
          <span class="text-4xl">{{ step().emoji }}</span>
          <p class="font-display text-6xl gradient-text">{{ step().count }}</p>
          <p class="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            {{ step().count === 1 ? 'thing' : 'things' }} you can {{ step().sense }}
          </p>
          <p class="max-w-xs text-sm text-muted-foreground">{{ step().prompt }}</p>
        </div>
        <div class="flex w-full items-center justify-between gap-3">
          <p-button label="Back" [text]="true" [disabled]="index() === 0" (onClick)="back()" />
          <div class="flex gap-1.5" aria-hidden="true">
            @for (dot of steps; track dot.count; let i = $index) {
              <span [class]="dotClass(i)"></span>
            }
          </div>
          <p-button [label]="index() === steps.length - 1 ? 'Done' : 'Next'" (onClick)="next()" />
        </div>
      } @else {
        <div class="flex flex-col items-center gap-3 animate-scale-in">
          <span class="text-4xl">🌿</span>
          <p class="font-display text-2xl">You're here.</p>
          <p class="max-w-xs text-sm text-muted-foreground">
            Five senses, one moment. You can run through it again anytime.
          </p>
          <p-button label="Start over" [outlined]="true" (onClick)="reset()" />
        </div>
      }
    </div>
  `,
})
export class GroundingStepsComponent {
  readonly steps = STEPS;
  readonly index = signal(0);
  readonly done = signal(false);
  private readonly feedback = inject(FeedbackService);

  readonly step = computed(() => STEPS[this.index()]);

  dotClass(i: number): string {
    return i === this.index()
      ? "h-2 w-6 rounded-full bg-gradient-primary transition-all"
      : "h-2 w-2 rounded-full bg-muted transition-all";
  }

  next() {
    if (this.done()) return;
    this.feedback.trigger("tap");
    if (this.index() === STEPS.length - 1) {
      this.done.set(true);
      this.feedback.trigger("success");
      return;
    }
    this.index.update((value) => value + 1);
  }

  back() {
    if (this.done() || this.index() === 0) return;
    this.feedback.trigger("tap");
    this.index.update((value) => Math.max(0, value - 1));
  }

  reset() {
    this.index.set(0);
    this.done.set(false);
  }
}
