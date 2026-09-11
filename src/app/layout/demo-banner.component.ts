import { Component, inject } from "@angular/core";
import { Router } from "@angular/router";
import { RoleService } from "../core/role.service";
import { exitDemo, resetDemo } from "../core/demo-session";

@Component({
  selector: "app-demo-banner",
  standalone: true,
  styles: `
    :host { display: block; position: sticky; top: 0; z-index: 30; }
    @media (min-width: 768px) {
      :host { top: 4rem; margin-top: 4rem; }
    }
  `,
  template: `
    <aside class="border-b border-primary/25 bg-accent/95 backdrop-blur-xl" aria-label="Demo mode">
      <div class="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 md:px-6">
        <div class="min-w-0 flex-1 basis-64">
          <p class="text-sm font-bold text-accent-foreground">Demo mode</p>
          <p class="mt-0.5 text-xs text-foreground/80">
            Fictional sample data. Changes stay in this tab. Reflections run locally.
          </p>
        </div>
        <div class="flex w-full min-w-0 items-center gap-2 sm:w-auto">
          <select
            aria-label="Explore demo pages"
            class="h-11 min-w-0 flex-1 rounded-xl border border-primary/30 bg-card px-3 text-xs font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-44"
            (change)="explore($event)"
          >
            <option value="" selected disabled>Explore demo pages</option>
            <optgroup label="Personal tools">
              <option value="/">Home</option>
              <option value="/mood-check">Mood check-in</option>
              <option value="/journal">Journal</option>
              <option value="/calendar">Calendar</option>
              <option value="/progress">Progress and goals</option>
              <option value="/insight">SIGGY Insight</option>
              <option value="/sentiment">Sentiment</option>
              <option value="/reminders">Reminders</option>
              <option value="/crisis-plan">Crisis plan</option>
            </optgroup>
            <optgroup label="Clinician tools">
              <option value="/clients">Clients</option>
              <option value="/soap-notes">SOAP notes</option>
            </optgroup>
            <optgroup label="Account and tour">
              <option value="/profile">Profile and exports</option>
              <option value="/settings">Settings</option>
              <option value="/onboarding">Welcome tour</option>
            </optgroup>
          </select>
          <button type="button" (click)="reset()" [class]="buttonClass" title="Restore the original sample data">
            Reset demo
          </button>
          <button type="button" (click)="exit()" [class]="buttonClass">
            Exit demo
          </button>
        </div>
      </div>
    </aside>
  `,
})
export class DemoBannerComponent {
  private readonly router = inject(Router);
  private readonly role = inject(RoleService);
  readonly reset = resetDemo;
  readonly exit = exitDemo;
  readonly buttonClass = "min-h-[44px] shrink-0 rounded-xl px-2 text-xs font-semibold text-accent-foreground transition-colors hover:bg-card/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  explore(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const path = select.value;
    if (!path) return;
    if (path === "/clients" || path === "/soap-notes") {
      this.role.setRole("clinician");
    } else if (!["/profile", "/settings", "/onboarding"].includes(path)) {
      this.role.setRole("client");
    }
    void this.router.navigateByUrl(path);
    select.value = "";
  }
}
