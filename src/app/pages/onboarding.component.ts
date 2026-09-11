import { Component, inject, signal } from "@angular/core";
import { Router } from "@angular/router";
import { ButtonModule } from "primeng/button";
import {
  HeartPulse,
  LucideAngularModule,
  NotebookPen,
  Shield,
  SmilePlus,
  Stethoscope,
  User,
} from "lucide-angular";
import { FeedbackService } from "../core/feedback.service";
import { RoleService } from "../core/role.service";
import { SafetyDisclosureComponent } from "../layout/safety-disclosure.component";

type Role = "client" | "clinician";

@Component({
  selector: "app-onboarding",
  standalone: true,
  imports: [ButtonModule, LucideAngularModule, SafetyDisclosureComponent],
  template: `
    <div class="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div class="w-full max-w-md space-y-6">
        <div class="glass-card-elevated relative overflow-hidden p-6 sm:p-8">
          <p-button
            label="Skip"
            [text]="true"
            size="small"
            styleClass="text-muted-foreground"
            class="absolute right-3 top-3"
            (onClick)="finish()"
          />

          <div class="min-h-[380px]">
            @switch (step()) {
              @case (0) {
                <div class="flex animate-slide-in-right flex-col items-center pt-8 text-center">
                  <span
                    class="mb-6 flex h-16 w-16 animate-float items-center justify-center rounded-2xl bg-gradient-primary shadow-glow"
                  >
                    <lucide-icon
                      [img]="icons.HeartPulse"
                      [size]="32"
                      class="text-primary-foreground"
                    />
                  </span>
                  <h1 class="text-3xl">Welcome to <span class="gradient-text">SIGGY</span></h1>
                  <p class="mt-3 text-base text-muted-foreground">
                    Reflect between sessions. Arrive ready to talk.
                  </p>
                  <p class="mt-4 max-w-xs text-sm text-muted-foreground">
                    SIGGY is a companion for the space between therapy sessions — a place to
                    check in, capture thoughts, and keep your plan close.
                  </p>
                </div>
              }
              @case (1) {
                <div class="animate-slide-in-right pt-4">
                  <h2 class="text-center text-2xl">What SIGGY helps with</h2>
                  <div class="mt-6 space-y-3">
                    @for (feature of features; track feature.title; let i = $index) {
                      <div
                        class="glass-card flex animate-fade-in-up items-start gap-3 p-4"
                        [style.animation-delay]="i * 80 + 'ms'"
                      >
                        <span
                          class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-primary-soft text-primary"
                        >
                          <lucide-icon [img]="feature.icon" [size]="20" />
                        </span>
                        <div>
                          <p class="font-medium">{{ feature.title }}</p>
                          <p class="text-sm text-muted-foreground">{{ feature.description }}</p>
                        </div>
                      </div>
                    }
                  </div>
                </div>
              }
              @case (2) {
                <div class="animate-slide-in-right pt-4">
                  <h2 class="text-center text-2xl">How will you use SIGGY?</h2>
                  <p class="mt-2 text-center text-sm text-muted-foreground">
                    You can change this later in Settings.
                  </p>
                  <div class="mt-6 grid gap-3">
                    <button
                      type="button"
                      (click)="chooseRole('client')"
                      class="card-interactive flex items-center gap-4 p-5 text-left"
                    >
                      <span
                        class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-primary text-primary-foreground shadow-glow"
                      >
                        <lucide-icon [img]="icons.User" [size]="24" />
                      </span>
                      <div>
                        <p class="font-medium">I'm a client</p>
                        <p class="text-sm text-muted-foreground">
                          Check in, journal, and prepare for sessions.
                        </p>
                      </div>
                    </button>
                    <button
                      type="button"
                      (click)="chooseRole('clinician')"
                      class="card-interactive flex items-center gap-4 p-5 text-left"
                    >
                      <span
                        class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-secondary text-secondary-foreground shadow-soft"
                      >
                        <lucide-icon [img]="icons.Stethoscope" [size]="24" />
                      </span>
                      <div>
                        <p class="font-medium">I'm a clinician</p>
                        <p class="text-sm text-muted-foreground">
                          Review shared summaries and keep session notes.
                        </p>
                      </div>
                    </button>
                  </div>
                </div>
              }
            }
          </div>

          <div class="mt-6 flex items-center justify-between">
            <p-button
              label="Back"
              icon="pi pi-arrow-left"
              [text]="true"
              [disabled]="step() === 0"
              (onClick)="back()"
            />
            <div class="flex gap-1.5" aria-hidden="true">
              @for (dot of [0, 1, 2]; track dot) {
                <span
                  class="h-2 rounded-full transition-all"
                  [class.w-6]="dot === step()"
                  [class.bg-gradient-primary]="dot === step()"
                  [class.w-2]="dot !== step()"
                  [class.bg-muted]="dot !== step()"
                ></span>
              }
            </div>
            @if (step() < 2) {
              <p-button label="Next" icon="pi pi-arrow-right" iconPos="right" (onClick)="next()" />
            } @else {
              <div class="w-[92px]" aria-hidden="true"></div>
            }
          </div>
        </div>

        <app-safety-disclosure class="block animate-fade-in" />
      </div>
    </div>
  `,
})
export class OnboardingComponent {
  readonly icons = { HeartPulse, User, Stethoscope };

  readonly features = [
    {
      icon: SmilePlus,
      title: "Check in",
      description: "A quick emoji, or a detailed 1–10 rating with tags — whatever today allows.",
    },
    {
      icon: NotebookPen,
      title: "Journal",
      description: "Capture thoughts before they fade, and save topics for your next session.",
    },
    {
      icon: Shield,
      title: "Crisis plan",
      description: "Your personal plan and tap-to-call contacts, one button away on every screen.",
    },
  ];

  private readonly router = inject(Router);
  private readonly feedback = inject(FeedbackService);
  private readonly roleService = inject(RoleService);

  readonly step = signal(0);

  next() {
    this.feedback.trigger("tap");
    this.step.update((s) => Math.min(s + 1, 2));
  }

  back() {
    this.feedback.trigger("tap");
    this.step.update((s) => Math.max(s - 1, 0));
  }

  chooseRole(role: Role) {
    this.roleService.setRole(role);
    this.feedback.trigger("success");
    this.router.navigate(["/"]);
  }

  finish() {
    if (!this.roleService.role()) this.roleService.setRole("client");
    this.router.navigate(["/"]);
  }
}
