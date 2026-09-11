import { Component, computed, inject, signal } from "@angular/core";
import { NavigationEnd, Router, RouterLink } from "@angular/router";
import { toSignal } from "@angular/core/rxjs-interop";
import { filter, map } from "rxjs";
import {
  Bell,
  CalendarDays,
  ClipboardList,
  HeartPulse,
  Home,
  LucideAngularModule,
  Menu,
  NotebookPen,
  Settings,
  Shield,
  Sparkles,
  TrendingUp,
  User,
  Users,
} from "lucide-angular";
import { MessageService, type MenuItem } from "primeng/api";
import { AvatarModule } from "primeng/avatar";
import { DrawerModule } from "primeng/drawer";
import { MenuModule } from "primeng/menu";
import { AuthService } from "../core/auth.service";
import { RoleService } from "../core/role.service";

const HIDDEN_PREFIXES = ["/auth", "/onboarding", "/shared-plan"];

@Component({
  selector: "app-navbar",
  standalone: true,
  imports: [RouterLink, LucideAngularModule, AvatarModule, DrawerModule, MenuModule],
  template: `
    @if (!hidden()) {
      <!-- Desktop: fixed top bar -->
      <header
        class="fixed inset-x-0 top-0 z-40 hidden border-b border-border/50 bg-card/80 backdrop-blur-xl md:block"
      >
        <div class="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
          <a routerLink="/" class="flex items-center gap-2.5" aria-label="SIGGY home">
            <span
              class="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-primary shadow-glow"
            >
              <lucide-icon [img]="icons.HeartPulse" [size]="20" class="text-primary-foreground" />
            </span>
            <span class="font-display text-xl">
              Check-In with <span class="gradient-text">SIGGY</span>
            </span>
          </a>

          <nav class="flex items-center gap-1" aria-label="Primary">
            @for (link of desktopLinks(); track link.to) {
              <a
                [routerLink]="link.to"
                [class]="desktopLinkClass(link.to)"
                [attr.aria-current]="active(link.to) ? 'page' : null"
              >
                {{ link.label }}
              </a>
            }
          </nav>

          <button
            type="button"
            (click)="accountMenu.toggle($event)"
            class="rounded-full transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            aria-label="Account menu"
          >
            <p-avatar
              [label]="initials()"
              shape="circle"
              [style]="{
                background: 'linear-gradient(135deg, hsl(var(--primary)), hsl(var(--secondary)))',
                color: 'hsl(var(--primary-foreground))'
              }"
            />
          </button>
          <p-menu #accountMenu [model]="accountItems()" [popup]="true" appendTo="body" />
        </div>
      </header>

      <!-- Mobile: fixed bottom tab bar -->
      <nav
        class="fixed inset-x-0 bottom-0 z-40 border-t border-border/50 bg-card/85 pb-safe backdrop-blur-xl md:hidden"
        aria-label="Primary"
      >
        <div class="grid h-16 grid-cols-4">
          @for (tab of mobileTabs; track tab.to) {
            <a
              [routerLink]="tab.to"
              [attr.aria-current]="active(tab.to) ? 'page' : null"
              class="flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors"
              [class.text-primary]="active(tab.to)"
              [class.text-muted-foreground]="!active(tab.to)"
            >
              <lucide-icon [img]="tab.icon" [size]="20" />
              {{ tab.label }}
            </a>
          }
          <button
            type="button"
            (click)="moreOpen.set(true)"
            class="flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors"
            [class.text-primary]="moreActive()"
            [class.text-muted-foreground]="!moreActive()"
            aria-label="More destinations"
          >
            <lucide-icon [img]="icons.Menu" [size]="20" />
            More
          </button>
        </div>
      </nav>

      <p-drawer
        [visible]="moreOpen()"
        (visibleChange)="moreOpen.set($event)"
        position="bottom"
        header="More"
        [style]="{ height: 'auto' }"
        [blockScroll]="true"
      >
        <div class="grid grid-cols-2 gap-2 pb-safe">
          @for (link of moreLinks(); track link.to) {
            <button
              type="button"
              (click)="go(link.to)"
              [class]="moreLinkClass(link.to)"
            >
              <lucide-icon [img]="link.icon" [size]="20" class="text-primary" />
              {{ link.label }}
            </button>
          }
        </div>
      </p-drawer>
    }
  `,
})
export class NavbarComponent {
  readonly icons = { HeartPulse, Menu };

  readonly mobileTabs = [
    { to: "/", label: "Home", icon: Home },
    { to: "/journal", label: "Journal", icon: NotebookPen },
    { to: "/insight", label: "Insight", icon: Sparkles },
  ];

  private readonly role = inject(RoleService);

  private readonly baseMoreLinks = [
    { to: "/therapy-sessions", label: "Sessions", icon: CalendarDays },
    { to: "/calendar", label: "Calendar", icon: CalendarDays },
    { to: "/reminders", label: "Reminders", icon: Bell },
    { to: "/progress", label: "Progress", icon: TrendingUp },
    { to: "/sentiment", label: "Sentiment", icon: HeartPulse },
    { to: "/crisis-plan", label: "Crisis plan", icon: Shield },
    { to: "/profile", label: "Profile", icon: User },
    { to: "/settings", label: "Settings", icon: Settings },
  ];

  /** Clinician tools appear only for the clinician role (RLS protects data regardless). */
  readonly moreLinks = computed(() =>
    this.role.isClinician()
      ? [
          { to: "/clients", label: "Clients", icon: Users },
          { to: "/soap-notes", label: "SOAP notes", icon: ClipboardList },
          ...this.baseMoreLinks,
        ]
      : this.baseMoreLinks
  );

  readonly desktopLinks = computed(() => {
    const base = [
      { to: "/", label: "Home" },
      { to: "/journal", label: "Journal" },
      { to: "/therapy-sessions", label: "Sessions" },
      { to: "/progress", label: "Progress" },
      { to: "/insight", label: "Insight" },
    ];
    return this.role.isClinician() ? [...base, { to: "/clients", label: "Clients" }] : base;
  });

  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly messages = inject(MessageService);
  readonly signingOut = signal(false);

  readonly moreOpen = signal(false);

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

  readonly initials = computed(() => (this.auth.user()?.email ?? "?").slice(0, 2).toUpperCase());

  readonly moreActive = computed(() => this.moreLinks().some((link) => this.active(link.to)));

  readonly accountItems = computed<MenuItem[]>(() => [
    { label: this.auth.user()?.email ?? "", disabled: true },
    { separator: true },
    { label: "Profile", icon: "pi pi-user", command: () => this.go("/profile") },
    { label: "Settings", icon: "pi pi-cog", command: () => this.go("/settings") },
    { label: "Crisis plan", icon: "pi pi-shield", command: () => this.go("/crisis-plan") },
    { separator: true },
    { label: "Sign out", icon: "pi pi-sign-out", disabled: this.signingOut(), command: () => this.signOut() },
  ]);

  active(to: string): boolean {
    const path = this.url().split("?")[0];
    return to === "/" ? path === "/" : path.startsWith(to);
  }

  /** Full class strings — Tailwind variant names (with : or /) can't be used in [class.x] bindings. */
  desktopLinkClass(to: string): string {
    const base = "rounded-full px-4 py-2 text-sm font-medium transition-colors";
    return this.active(to)
      ? `${base} bg-accent text-accent-foreground`
      : `${base} text-muted-foreground hover:bg-muted hover:text-foreground`;
  }

  moreLinkClass(to: string): string {
    const base =
      "flex min-h-[52px] items-center gap-3 rounded-xl border px-4 py-3 text-sm font-medium transition-colors";
    return this.active(to)
      ? `${base} border-primary/40 bg-accent text-accent-foreground`
      : `${base} border-border/60 bg-card/70 hover:bg-accent`;
  }

  go(to: string) {
    this.moreOpen.set(false);
    this.router.navigate([to]);
  }

  async signOut() {
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
}
