import { Component, inject } from "@angular/core";
import { LucideAngularModule, Stethoscope } from "lucide-angular";
import { MessageService } from "primeng/api";
import { ButtonModule } from "primeng/button";
import { RoleService } from "../core/role.service";
import { FeedbackService } from "../core/feedback.service";

/**
 * Wraps clinician-only content. Non-clinicians see a friendly switch instead —
 * a UI convenience only; the underlying tables are RLS-protected either way.
 */
@Component({
  selector: "app-clinician-gate",
  standalone: true,
  imports: [LucideAngularModule, ButtonModule],
  template: `
    @if (role.isClinician()) {
      <ng-content />
    } @else {
      <div class="empty-state mt-8 animate-fade-in-up">
        <div class="empty-state-icon">
          <lucide-icon [img]="Stethoscope" [size]="24" />
        </div>
        <p class="font-medium">Clinician tools are off</p>
        <p class="max-w-xs text-sm text-muted-foreground">
          Client lists and session notes are part of SIGGY's clinician surface. Turn them on if
          that's you — you can switch back anytime.
        </p>
        <p-button label="Enable clinician tools" styleClass="btn-glow mt-2" (onClick)="enable()" />
      </div>
    }
  `,
})
export class ClinicianGateComponent {
  readonly Stethoscope = Stethoscope;
  readonly role = inject(RoleService);
  private readonly feedback = inject(FeedbackService);
  private readonly messages = inject(MessageService);

  enable() {
    this.role.setRole("clinician");
    this.feedback.trigger("success");
    this.messages.add({
      severity: "success",
      summary: "Clinician tools on",
      detail: "Clients and SOAP notes are now in your navigation.",
    });
  }
}
