import { Component, inject } from "@angular/core";
import { RouterOutlet } from "@angular/router";
import { ToastModule } from "primeng/toast";
import { NavbarComponent } from "./layout/navbar.component";
import { HelpNowButtonComponent } from "./layout/help-now-button.component";
import { FloatingMoodButtonComponent } from "./layout/floating-mood-button.component";
import { RemindersService } from "./core/reminders.service";

@Component({
  selector: "app-root",
  standalone: true,
  imports: [
    RouterOutlet,
    ToastModule,
    NavbarComponent,
    HelpNowButtonComponent,
    FloatingMoodButtonComponent,
  ],
  template: `
    <router-outlet />
    <app-navbar />
    <app-floating-mood-button />
    <app-help-now-button />
    <p-toast position="top-center" />
  `,
})
export class AppComponent {
  // Instantiated eagerly so the reminder scheduler runs app-wide.
  private readonly reminders = inject(RemindersService);
}
