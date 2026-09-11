import { Component, inject, signal } from "@angular/core";
import { ActivatedRoute, Router } from "@angular/router";
import {
  NonNullableFormBuilder,
  ReactiveFormsModule,
  Validators,
  type AbstractControl,
} from "@angular/forms";
import { MessageService } from "primeng/api";
import { ButtonModule } from "primeng/button";
import { InputTextModule } from "primeng/inputtext";
import { TabsModule } from "primeng/tabs";
import { HeartPulse, LucideAngularModule } from "lucide-angular";
import { supabase, supabaseConfigured } from "../core/supabase.client";
import { AuthService } from "../core/auth.service";
import { FeedbackService } from "../core/feedback.service";
import { SafetyDisclosureComponent } from "../layout/safety-disclosure.component";
import { enterDemo } from "../core/demo-session";

function friendlyAuthError(message: string): string {
  if (/invalid login credentials/i.test(message)) {
    return "Email or password doesn't match. Try again.";
  }
  if (/already registered/i.test(message)) {
    return "That email already has an account. Sign in instead.";
  }
  if (/rate limit/i.test(message)) {
    return "Too many attempts. Wait a moment, then try again.";
  }
  return message;
}

@Component({
  selector: "app-auth",
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ButtonModule,
    InputTextModule,
    TabsModule,
    LucideAngularModule,
    SafetyDisclosureComponent,
  ],
  template: `
    <div class="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div class="w-full max-w-md space-y-6">
        <div class="glass-card-elevated animate-fade-in-up p-6 sm:p-8">
          <div class="mb-4 flex flex-col items-center text-center">
            <span
              class="mb-4 flex h-14 w-14 animate-float items-center justify-center rounded-2xl bg-gradient-primary shadow-glow"
            >
              <lucide-icon [img]="HeartPulse" [size]="28" class="text-primary-foreground" />
            </span>
            <h1 class="text-3xl">Check-In with <span class="gradient-text">SIGGY</span></h1>
            <p class="mt-2 text-sm text-muted-foreground">
              Reflect between sessions. Arrive ready to talk.
            </p>
          </div>

          <section class="mb-5 rounded-2xl border border-primary/30 bg-accent/60 p-4" aria-label="Explore SIGGY">
            <p class="font-semibold">Take SIGGY for a spin</p>
            <p class="mt-1 text-sm text-muted-foreground">
              Explore check-ins, journals and clinician tools with fictional sample data.
              No account needed. Demo changes stay in this browser tab.
            </p>
            <p-button
              label="Explore demo"
              ariaLabel="Explore demo"
              icon="pi pi-play"
              styleClass="mt-3 w-full btn-glow"
              class="block w-full"
              (onClick)="exploreDemo()"
            />
          </section>

          @if (!configured) {
            <div role="alert" class="mb-4 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm">
              <p class="font-medium">Setup required</p>
              <p class="mt-1">Sign-in is unavailable until this app is connected to its secure account service. Please contact your SIGGY administrator.</p>
            </div>
          }
          @if (verificationMessage()) {
            <div role="status" class="mb-4 rounded-xl bg-accent p-4 text-sm">{{ verificationMessage() }}</div>
          }
          <p-tabs value="sign-in">
            <p-tablist>
              <p-tab value="sign-in" class="flex-1 justify-center">Sign in</p-tab>
              <p-tab value="sign-up" class="flex-1 justify-center">Sign up</p-tab>
            </p-tablist>
            <p-tabpanels>
              <p-tabpanel value="sign-in">
                <form [formGroup]="signInForm" (ngSubmit)="signIn()" class="space-y-4 pt-2">
                  <div class="space-y-2">
                    <label class="text-sm font-medium" for="si-email">Email</label>
                    <input
                      pInputText
                      id="si-email"
                      type="email"
                      autocomplete="email"
                      placeholder="you@example.com"
                      formControlName="email"
                    />
                    @if (showError(signInForm.controls.email)) {
                      <small class="block text-sm font-medium text-destructive">
                        Enter a valid email
                      </small>
                    }
                  </div>
                  <div class="space-y-2">
                    <label class="text-sm font-medium" for="si-password">Password</label>
                    <input
                      pInputText
                      id="si-password"
                      type="password"
                      autocomplete="current-password"
                      placeholder="Your password"
                      formControlName="password"
                    />
                    @if (showError(signInForm.controls.password)) {
                      <small class="block text-sm font-medium text-destructive">
                        Enter your password
                      </small>
                    }
                  </div>
                  <p-button
                    type="submit"
                    label="Sign in"
                    styleClass="w-full btn-glow"
                    class="block w-full"
                    [loading]="submitting()"
                    [disabled]="submitting() || !configured"
                  />
                </form>
              </p-tabpanel>
              <p-tabpanel value="sign-up">
                <form [formGroup]="signUpForm" (ngSubmit)="signUp()" class="space-y-4 pt-2">
                  <div class="space-y-2">
                    <label class="text-sm font-medium" for="su-email">Email</label>
                    <input
                      pInputText
                      id="su-email"
                      type="email"
                      autocomplete="email"
                      placeholder="you@example.com"
                      formControlName="email"
                    />
                    @if (showError(signUpForm.controls.email)) {
                      <small class="block text-sm font-medium text-destructive">
                        Enter a valid email
                      </small>
                    }
                  </div>
                  <div class="space-y-2">
                    <label class="text-sm font-medium" for="su-password">Password</label>
                    <input
                      pInputText
                      id="su-password"
                      type="password"
                      autocomplete="new-password"
                      placeholder="At least 8 characters"
                      formControlName="password"
                    />
                    @if (showError(signUpForm.controls.password)) {
                      <small class="block text-sm font-medium text-destructive">
                        Use at least 8 characters
                      </small>
                    }
                  </div>
                  <p-button
                    type="submit"
                    label="Create account"
                    styleClass="w-full btn-glow"
                    class="block w-full"
                    [loading]="submitting()"
                    [disabled]="submitting() || !configured"
                  />
                </form>
              </p-tabpanel>
            </p-tabpanels>
          </p-tabs>
        </div>

        <app-safety-disclosure class="block animate-fade-in" />
      </div>
    </div>
  `,
})
export class AuthComponent {
  readonly HeartPulse = HeartPulse;
  readonly exploreDemo = enterDemo;

  private readonly fb = inject(NonNullableFormBuilder);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly feedback = inject(FeedbackService);
  private readonly messages = inject(MessageService);

  readonly submitting = signal(false);
  readonly verificationMessage = signal("");
  readonly configured = supabaseConfigured;
  private readonly route = inject(ActivatedRoute);

  private destination(): string {
    const requested = this.route.snapshot.queryParamMap.get("returnUrl") ?? "/";
    return requested.startsWith("/") && !requested.startsWith("//") &&
      !requested.includes("\\") && !/^\/(auth|onboarding)(?:[/?#]|$)/.test(requested)
      ? requested : "/";
  }

  readonly signInForm = this.fb.group({
    email: ["", [Validators.required, Validators.email]],
    password: ["", Validators.required],
  });

  readonly signUpForm = this.fb.group({
    email: ["", [Validators.required, Validators.email]],
    password: ["", [Validators.required, Validators.minLength(8)]],
  });

  constructor() {
    // Only redirect a session already present at startup. Redirecting in a user
    // signal effect races an immediate-session signup and skips onboarding.
    void this.auth.ready.then(() => {
      if (this.auth.user() && !this.submitting()) {
        void this.router.navigateByUrl(this.destination());
      }
    });
  }

  showError(control: AbstractControl): boolean {
    return control.touched && control.invalid;
  }

  async signIn() {
    if (this.submitting() || !this.configured) return;
    if (this.signInForm.invalid) {
      this.signInForm.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    try {
      const { email, password } = this.signInForm.getRawValue();
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
      this.feedback.trigger("success");
      await this.router.navigateByUrl(this.destination());
    } catch (error) {
      this.authFailure("Sign in failed", error);
    } finally {
      this.submitting.set(false);
    }
  }

  async signUp() {
    if (this.submitting() || !this.configured) return;
    if (this.signUpForm.invalid) {
      this.signUpForm.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    this.verificationMessage.set("");
    try {
      const { email, password } = this.signUpForm.getRawValue();
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { emailRedirectTo: `${window.location.origin}/onboarding` },
      });
      if (error) throw error;
      this.feedback.trigger("success");
      if (data.session) {
        await this.router.navigate(["/onboarding"]);
      } else {
        this.verificationMessage.set("Check your email to confirm your account, then sign in. If you already have an account, use Sign in.");
        this.signUpForm.controls.password.reset();
      }
    } catch (error) {
      this.authFailure("Sign up failed", error);
    } finally {
      this.submitting.set(false);
    }
  }

  private authFailure(summary: string, error: unknown) {
    this.feedback.trigger("error");
    this.messages.add({
      severity: "error", summary,
      detail: friendlyAuthError(error instanceof Error ? error.message : "Unable to connect. Please try again."),
    });
  }
}
