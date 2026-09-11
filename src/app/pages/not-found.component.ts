import { Component } from "@angular/core";
import { RouterLink } from "@angular/router";
import { Compass, LucideAngularModule } from "lucide-angular";
import { ButtonModule } from "primeng/button";

@Component({
  selector: "app-not-found",
  standalone: true,
  imports: [RouterLink, LucideAngularModule, ButtonModule],
  template: `
    <div class="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      <div class="glass-card-elevated flex max-w-md animate-fade-in-up flex-col items-center px-8 py-12">
        <span
          class="mb-4 flex h-14 w-14 animate-float items-center justify-center rounded-2xl bg-gradient-primary-soft text-primary"
        >
          <lucide-icon [img]="Compass" [size]="28" />
        </span>
        <p class="gradient-text font-display text-6xl">404</p>
        <h1 class="mt-3 text-2xl">This page wandered off</h1>
        <p class="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has moved.
        </p>
        <a routerLink="/" class="mt-6">
          <p-button label="Back home" styleClass="btn-glow" />
        </a>
      </div>
    </div>
  `,
})
export class NotFoundComponent {
  readonly Compass = Compass;
}
