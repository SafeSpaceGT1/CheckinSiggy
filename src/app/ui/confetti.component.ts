import { Component, signal } from "@angular/core";

interface Piece {
  id: number;
  left: number;
  delay: number;
  duration: number;
  color: string;
  size: number;
}

/**
 * A small celebratory burst. Fire() renders a batch of falling pieces and
 * clears them once the animation ends. Respects prefers-reduced-motion via
 * the global CSS override (animations collapse to invisible instantly).
 */
@Component({
  selector: "app-confetti",
  standalone: true,
  template: `
    @if (pieces().length > 0) {
      <div class="pointer-events-none fixed inset-0 z-[60] overflow-hidden" aria-hidden="true">
        @for (piece of pieces(); track piece.id) {
          <span
            class="absolute top-0 block animate-confetti-fall"
            [style.left.%]="piece.left"
            [style.animation-delay.ms]="piece.delay"
            [style.animation-duration.ms]="piece.duration"
          >
            <span
              class="block animate-confetti-spin rounded-[2px]"
              [style.width.px]="piece.size"
              [style.height.px]="piece.size * 1.6"
              [style.background]="piece.color"
            ></span>
          </span>
        }
      </div>
    }
  `,
})
export class ConfettiComponent {
  readonly pieces = signal<Piece[]>([]);
  private sequence = 0;
  private timer?: ReturnType<typeof setTimeout>;

  fire(count = 28) {
    const colors = [
      "hsl(var(--primary))",
      "hsl(var(--secondary))",
      "hsl(var(--gradient-end))",
      "hsl(var(--warning))",
    ];
    const batch: Piece[] = Array.from({ length: count }, (_, i) => ({
      id: this.sequence++,
      left: Math.random() * 100,
      delay: Math.random() * 250,
      duration: 2200 + Math.random() * 900,
      color: colors[i % colors.length],
      size: 6 + Math.random() * 6,
    }));
    this.pieces.set(batch);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.pieces.set([]), 3400);
  }
}
