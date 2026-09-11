import { Component, inject } from "@angular/core";
import { RouterOutlet } from "@angular/router";
import { ToastModule } from "primeng/toast";
import { NavbarComponent } from "./layout/navbar.component";
import { HelpNowButtonComponent } from "./layout/help-now-button.component";
import { FloatingMoodButtonComponent } from "./layout/floating-mood-button.component";
import { RemindersService } from "./core/reminders.service";
import { DemoBannerComponent } from "./layout/demo-banner.component";
import { isDemoMode } from "./core/demo-session";
import { SessionCheckInComponent } from "./layout/session-check-in.component";

@Component({
  selector: "app-root",
  standalone: true,
  imports: [
    RouterOutlet,
    ToastModule,
    NavbarComponent,
    HelpNowButtonComponent,
    FloatingMoodButtonComponent,
    DemoBannerComponent,
    SessionCheckInComponent,
  ],
  template: `
    @if (demo) {
      <app-demo-banner />
    }
    <router-outlet />
    <app-navbar />
    <app-floating-mood-button />
    <app-help-now-button />
    @defer (on idle) {
      <app-session-check-in />
    }
    <p-toast position="top-center" />
  `,
})
export class AppComponent {
  readonly demo = isDemoMode();
  // Instantiated eagerly so the reminder scheduler runs app-wide.
  private readonly reminders = inject(RemindersService);
}
