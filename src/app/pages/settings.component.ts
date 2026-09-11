import { Component, computed, inject, signal } from "@angular/core";
import { Router } from "@angular/router";
import { FormsModule } from "@angular/forms";
import { LogOut, LucideAngularModule, Moon, Sun, SunMoon, TriangleAlert } from "lucide-angular";
import { MessageService } from "primeng/api";
import { ButtonModule } from "primeng/button";
import { DialogModule } from "primeng/dialog";
import { InputTextModule } from "primeng/inputtext";
import { SliderModule } from "primeng/slider";
import { ToggleSwitchModule } from "primeng/toggleswitch";
import { supabase } from "../core/supabase.client";
import { AuthService } from "../core/auth.service";
import { SettingsService, type ThemePreference } from "../core/settings.service";
import { RoleService } from "../core/role.service";
import { FeedbackService } from "../core/feedback.service";
import { PageContainerComponent } from "../layout/page-container.component";
import { SafetyDisclosureComponent } from "../layout/safety-disclosure.component";
import { exitDemo, isDemoMode } from "../core/demo-session";

const THEMES: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: SunMoon },
];

@Component({
  selector: "app-settings",
  standalone: true,
  imports: [
    FormsModule,
    LucideAngularModule,
    ButtonModule,
    DialogModule,
    InputTextModule,
    SliderModule,
    ToggleSwitchModule,
    PageContainerComponent,
    SafetyDisclosureComponent,
  ],
  template: `
    <app-page-container maxWidth="md">
      <header class="animate-fade-in-up">
        <h1 class="text-3xl">Settings</h1>
        <p class="mt-2 text-sm text-muted-foreground">Make SIGGY feel like yours.</p>
      </header>

      <section class="glass-card mt-6 animate-fade-in-up p-5" style="animation-delay: 60ms" aria-label="Appearance">
        <h2 class="text-lg">Appearance</h2>
        <div class="mt-3 flex gap-2">
          @for (theme of themes; track theme.value) {
            <button type="button" (click)="setTheme(theme.value)" [attr.aria-pressed]="settings.theme() === theme.value" [class]="themeChip(theme.value)">
              <lucide-icon [img]="theme.icon" [size]="16" />
              {{ theme.label }}
            </button>
          }
        </div>
      </section>

      <section class="glass-card mt-4 animate-fade-in-up p-5" style="animation-delay: 100ms" aria-label="Feedback">
        <h2 class="text-lg">Feedback</h2>
        <div class="mt-3 space-y-3">
          <div class="flex items-center justify-between gap-4">
            <div>
              <label class="text-sm font-medium" for="haptics-toggle">Haptics</label>
              <p class="text-xs text-muted-foreground">A little buzz on taps and saves.</p>
            </div>
            <p-toggleswitch
              inputId="haptics-toggle"
              [ngModel]="settings.hapticsEnabled()"
              (ngModelChange)="settings.hapticsEnabled.set($event)"
            />
          </div>
          <div class="flex items-center justify-between gap-4">
            <div>
              <label class="text-sm font-medium" for="sound-toggle">Sounds</label>
              <p class="text-xs text-muted-foreground">Soft tones for wins and warnings.</p>
            </div>
            <p-toggleswitch
              inputId="sound-toggle"
              [ngModel]="settings.soundEnabled()"
              (ngModelChange)="settings.soundEnabled.set($event)"
            />
          </div>
        </div>
      </section>

      <section class="glass-card mt-4 animate-fade-in-up p-5" style="animation-delay: 140ms" aria-label="Crisis plan review">
        <div class="flex items-center justify-between">
          <h2 class="text-lg">Crisis plan review</h2>
          <span class="font-display text-xl">{{ settings.reviewIntervalDays() }} days</span>
        </div>
        <p class="mt-1 text-xs text-muted-foreground">
          SIGGY will gently suggest a read-through when your plan gets older than this.
        </p>
        <div class="px-1 pb-1 pt-4">
          <p-slider
            [ngModel]="settings.reviewIntervalDays()"
            (ngModelChange)="settings.reviewIntervalDays.set($event)"
            [min]="30"
            [max]="180"
            [step]="15"
            ariaLabel="Crisis plan review interval in days"
          />
        </div>
      </section>

      <section class="glass-card mt-4 animate-fade-in-up p-5" style="animation-delay: 180ms" aria-label="Role">
        <h2 class="text-lg">I use SIGGY as…</h2>
        <div class="mt-3 flex gap-2">
          <button type="button" (click)="setRole('client')" [attr.aria-pressed]="roleService.role() === 'client'" [class]="roleChip('client')">
            A client
          </button>
          <button type="button" (click)="setRole('clinician')" [attr.aria-pressed]="roleService.role() === 'clinician'" [class]="roleChip('clinician')">
            A clinician
          </button>
        </div>
        <p class="mt-2 text-xs text-muted-foreground">
          Clinician mode adds Clients and SOAP notes to your navigation.
        </p>
      </section>

      <div class="mt-4 animate-fade-in-up" style="animation-delay: 220ms">
        <app-safety-disclosure />
      </div>

      <section class="glass-card mt-4 animate-fade-in-up p-5" style="animation-delay: 260ms" aria-label="Account">
        <h2 class="text-lg">Account</h2>
        <p class="mt-1 truncate text-sm text-muted-foreground">{{ demo ? 'Sample account:' : 'Signed in as' }} {{ email() }}</p>
        <p-button
          [label]="demo ? 'Exit demo' : 'Sign out'"
          [ariaLabel]="demo ? 'Exit demo' : 'Sign out'"
          icon="pi pi-sign-out"
          [outlined]="true"
          styleClass="mt-3"
          [loading]="signingOut()"
          (onClick)="signOut()"
        />
      </section>

      <section
        class="mt-4 animate-fade-in-up rounded-2xl border border-destructive/30 bg-destructive/5 p-5"
        style="animation-delay: 300ms"
        aria-label="Danger zone"
      >
        <div class="flex items-center gap-2">
          <lucide-icon [img]="icons.TriangleAlert" [size]="18" class="text-destructive" />
          <h2 class="text-lg">{{ demo ? 'Demo data' : 'Danger zone' }}</h2>
        </div>
        <p class="mt-2 text-sm text-muted-foreground">
          @if (demo) {
            Clear the fictional sample data and changes in this tab, then exit the demo.
            No real account is deleted. Explore the demo again to start fresh.
          } @else {
            Deleting your account removes every check-in, journal entry, goal, session,
            crisis plan, share link, client, and note — permanently. There is no undo.
          }
        </p>
        <p-button
          [label]="demo ? 'Clear demo data' : 'Delete my account'"
          severity="danger"
          [outlined]="true"
          styleClass="mt-3"
          (onClick)="openDelete()"
        />
      </section>
    </app-page-container>

    <p-dialog
      [header]="demo ? 'Clear demo data?' : 'Delete account?'"
      [visible]="deleteOpen()"
      (visibleChange)="deleteOpen.set($event)"
      [modal]="true"
      [closable]="!deleting()"
      [closeOnEscape]="!deleting()"
      [draggable]="false"
      [resizable]="false"
      [style]="{ width: 'min(92vw, 420px)' }"
    >
      <p class="text-sm text-muted-foreground">
        @if (demo) {
          This clears only the sample data and your demo changes in this tab.
          You will return to the sign-in screen.
        } @else {
          This permanently deletes your account and all of your data. Consider a
          <span class="font-medium text-foreground">JSON export from Profile</span> first.
        }
      </p>
      <label class="mt-4 block text-sm font-medium" for="delete-confirm">
        Type <span class="font-semibold">DELETE</span> to confirm
      </label>
      <input
        pInputText
        id="delete-confirm"
        class="mt-2 w-full"
        autocomplete="off"
        [ngModel]="confirmText()"
        (ngModelChange)="confirmText.set($event)"
      />
      <div class="mt-4 flex gap-2">
        <p-button
          [label]="demo ? 'Clear demo and exit' : 'Delete forever'"
          severity="danger"
          styleClass="w-full"
          class="block flex-1"
          [disabled]="confirmText() !== 'DELETE' || deleting()"
          [loading]="deleting()"
          (onClick)="deleteAccount()"
        />
        <p-button label="Cancel" [text]="true" [disabled]="deleting()" (onClick)="deleteOpen.set(false)" />
      </div>
    </p-dialog>
  `,
})
export class SettingsComponent {
  readonly demo = isDemoMode();
  readonly icons = { TriangleAlert, LogOut };
  readonly themes = THEMES;

  readonly settings = inject(SettingsService);
  readonly roleService = inject(RoleService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly feedback = inject(FeedbackService);
  private readonly messages = inject(MessageService);

  readonly deleteOpen = signal(false);
  readonly confirmText = signal("");
  readonly deleting = signal(false);
  readonly signingOut = signal(false);

  readonly email = computed(() => this.auth.user()?.email ?? "");

  setTheme(theme: ThemePreference) {
    this.feedback.trigger("tap");
    this.settings.theme.set(theme);
  }

  setRole(role: "client" | "clinician") {
    this.feedback.trigger("tap");
    this.roleService.setRole(role);
  }

  /** Full class strings — Tailwind variant names can't live in [class.x] bindings. */
  themeChip(theme: ThemePreference): string {
    const base =
      "flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-full border px-3 py-2 text-sm font-medium transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
    return this.settings.theme() === theme
      ? `${base} border-transparent bg-gradient-primary text-primary-foreground shadow-glow`
      : `${base} border-border/60 bg-card/70 hover:border-primary/40`;
  }

  roleChip(role: "client" | "clinician"): string {
    const base =
      "min-h-[44px] flex-1 rounded-full border px-4 py-2 text-sm font-medium transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
    return this.roleService.role() === role
      ? `${base} border-transparent bg-gradient-primary text-primary-foreground shadow-glow`
      : `${base} border-border/60 bg-card/70 hover:border-primary/40`;
  }

  async signOut() {
    if (this.demo) {
      exitDemo();
      return;
    }
    if (this.signingOut()) return;
    this.signingOut.set(true);
    try {
      await this.auth.signOut();
      await this.router.navigate(["/auth"]);
    } catch {
      this.messages.add({ severity: "error", summary: "Couldn't sign out", detail: "Please try again." });
    } finally {
      this.signingOut.set(false);
    }
  }

  openDelete() {
    this.confirmText.set("");
    this.deleteOpen.set(true);
  }

  async deleteAccount() {
    if (this.deleting() || this.confirmText() !== "DELETE") return;
    this.deleting.set(true);
    try {
      const { data, error } = await supabase.functions.invoke("delete-account", { body: {} });
      if (error || !data?.deleted) {
        throw new Error(
          (error as Error | null)?.message ?? "The server couldn't delete the account."
        );
      }
      if (this.demo) {
        exitDemo();
        return;
      }
      await supabase.auth.signOut();
      this.messages.add({
        severity: "success",
        summary: "Account deleted",
        detail: "Everything has been removed. Take care of yourself.",
        life: 8000,
      });
      this.router.navigate(["/auth"]);
    } catch (error) {
      this.feedback.trigger("error");
      this.messages.add({
        severity: "error",
        summary: "Couldn't delete account",
        detail: (error as Error).message,
      });
    } finally {
      this.deleting.set(false);
      this.deleteOpen.set(false);
    }
  }
}
