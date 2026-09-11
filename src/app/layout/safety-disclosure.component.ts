import { Component } from "@angular/core";
import { LucideAngularModule, TriangleAlert } from "lucide-angular";

/**
 * Safety-boundary disclosure. Shown at auth, onboarding, and Settings —
 * exact copy required by the product brief.
 */
@Component({
  selector: "app-safety-disclosure",
  standalone: true,
  imports: [LucideAngularModule],
  template: `
    <div
      role="alert"
      class="flex items-start gap-3 rounded-2xl border border-warning/50 bg-warning/10 p-4 text-sm text-foreground"
    >
      <lucide-icon [img]="TriangleAlert" [size]="16" class="mt-0.5 shrink-0 text-warning" />
      <p class="leading-relaxed">
        SIGGY is not continuously monitored. For urgent concerns, contact emergency services or
        your crisis plan.
      </p>
    </div>
  `,
})
export class SafetyDisclosureComponent {
  readonly TriangleAlert = TriangleAlert;
}
