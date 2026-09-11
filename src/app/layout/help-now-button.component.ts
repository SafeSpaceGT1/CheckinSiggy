import { Component, computed, inject } from "@angular/core";
import { NavigationEnd, Router } from "@angular/router";
import { toSignal } from "@angular/core/rxjs-interop";
import { filter, map } from "rxjs";
import { LifeBuoy, LucideAngularModule } from "lucide-angular";
import { AuthService } from "../core/auth.service";

const HIDDEN_PREFIXES = ["/auth", "/onboarding", "/crisis-plan", "/shared-plan"];

/**
 * Persistent "I need help now" action. Visible on every authenticated screen
 * except the crisis plan itself and the public/onboarding routes.
 */
@Component({
  selector: "app-help-now-button",
  standalone: true,
  imports: [LucideAngularModule],
  template: `
    @if (!hidden()) {
      <div class="fixed bottom-20 right-4 z-40 animate-scale-in md:bottom-6 md:right-6">
        <button
          type="button"
          (click)="open()"
          aria-label="I need help now — open my crisis plan"
          class="flex h-12 items-center gap-2 rounded-full bg-destructive px-5 text-sm font-semibold text-destructive-foreground shadow-lg transition-transform hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive focus-visible:ring-offset-2"
        >
          <lucide-icon [img]="LifeBuoy" [size]="20" />
          I need help now
        </button>
      </div>
    }
  `,
})
export class HelpNowButtonComponent {
  readonly LifeBuoy = LifeBuoy;
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
    this.router.navigate(["/crisis-plan"]);
  }
}
