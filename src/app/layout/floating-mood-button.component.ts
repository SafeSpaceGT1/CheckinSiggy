import { Component, computed, inject } from "@angular/core";
import { NavigationEnd, Router } from "@angular/router";
import { toSignal } from "@angular/core/rxjs-interop";
import { filter, map } from "rxjs";
import { LucideAngularModule, SmilePlus } from "lucide-angular";
import { TooltipModule } from "primeng/tooltip";
import { AuthService } from "../core/auth.service";

const HIDDEN_PREFIXES = ["/auth", "/onboarding", "/crisis-plan", "/shared-plan", "/mood-check"];

/**
 * Always-available shortcut to a mood check-in. Hidden on public routes,
 * on the crisis plan (keep that screen calm), and on the check-in page itself.
 */
@Component({
  selector: "app-floating-mood-button",
  standalone: true,
  imports: [LucideAngularModule, TooltipModule],
  template: `
    @if (!hidden()) {
      <div class="fixed bottom-20 left-4 z-40 animate-scale-in md:bottom-6 md:left-6">
        <button
          type="button"
          (click)="open()"
          aria-label="Quick mood check-in"
          pTooltip="Quick check-in"
          tooltipPosition="right"
          class="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-primary text-primary-foreground shadow-glow transition-all hover:scale-105 hover:shadow-glow-lg active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <lucide-icon [img]="SmilePlus" [size]="24" />
        </button>
      </div>
    }
  `,
})
export class FloatingMoodButtonComponent {
  readonly SmilePlus = SmilePlus;
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map(() => this.router.url)
    ),
    { initialValue: this.router.url }
  );

  readonly hidden = computed(() => {
    const path = this.url().split("?")[0];
    return !this.auth.user() || HIDDEN_PREFIXES.some((prefix) => path.startsWith(prefix));
  });

  open() {
    this.router.navigate(["/mood-check"]);
  }
}
