import { Component, computed, signal, type OnDestroy, type OnInit } from "@angular/core";

interface Phase {
  label: string;
  seconds: number;
  scale: number;
}

/** 4-7-8 breathing: in for 4, hold for 7, out for 8. The ring leads the pace. */
const PHASES: Phase[] = [
  { label: "Breathe in", seconds: 4, scale: 1.32 },
  { label: "Hold", seconds: 7, scale: 1.32 },
  { label: "Breathe out", seconds: 8, scale: 1 },
];

@Component({
  selector: "app-breathing-ring",
  standalone: true,
  template: `
    <div class="flex flex-col items-center gap-6 py-4">
      <div class="relative flex h-52 w-52 items-center justify-center">
        <div
          class="absolute inset-0 rounded-full bg-gradient-primary opacity-15"
          [style.transform]="'scale(' + scale() + ')'"
          [style.transition]="'transform ' + phase().seconds + 's ease-in-out'"
        ></div>
        <div
          class="absolute inset-6 rounded-full bg-gradient-primary opacity-25"
          [style.transform]="'scale(' + scale() + ')'"
          [style.transition]="'transform ' + phase().seconds + 's ease-in-out'"
        ></div>
        <div
          class="flex h-28 w-28 flex-col items-center justify-center rounded-full bg-gradient-primary text-primary-foreground shadow-glow"
          [style.transform]="'scale(' + scale() + ')'"
          [style.transition]="'transform ' + phase().seconds + 's ease-in-out'"
        >
          <span class="font-display text-3xl tabular-nums">{{ countdown() }}</span>
        </div>
      </div>
      <div class="text-center">
        <p class="font-display text-2xl" aria-live="polite">{{ phase().label }}</p>
        <p class="mt-1 text-xs text-muted-foreground">
          4-7-8 breathing · cycle {{ cycle() }}
        </p>
      </div>
    </div>
  `,
})
export class BreathingRingComponent implements OnInit, OnDestroy {
  private readonly phaseIndex = signal(0);
  readonly countdown = signal(PHASES[0].seconds);
  readonly cycle = signal(1);
  private timer?: ReturnType<typeof setInterval>;
  private startedAt = 0;

  readonly phase = computed(() => PHASES[this.phaseIndex()]);
  readonly scale = computed(() => this.phase().scale);

  ngOnInit() {
    this.startedAt = Date.now();
    this.timer = setInterval(() => {
      // Derive the phase from elapsed time so delayed/background callbacks do not
      // stretch an inhale or hold beyond its intended duration.
      const cycleSeconds = PHASES.reduce((sum, phase) => sum + phase.seconds, 0);
      const elapsed = Math.floor(Math.max(0, Date.now() - this.startedAt) / 1000);
      this.cycle.set(Math.floor(elapsed / cycleSeconds) + 1);
      let offset = elapsed % cycleSeconds;
      for (let index = 0; index < PHASES.length; index += 1) {
        if (offset < PHASES[index].seconds) {
          this.phaseIndex.set(index);
          this.countdown.set(PHASES[index].seconds - offset);
          return;
        }
        offset -= PHASES[index].seconds;
      }
    }, 250);
  }

  ngOnDestroy() {
    clearInterval(this.timer);
  }
}
