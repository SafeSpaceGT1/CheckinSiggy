import type { Routes } from "@angular/router";
import { authGuard } from "./core/auth.guard";

const APP = "Check-In with SIGGY";

/**
 * Every page is lazy-loaded: the initial bundle carries only the shell
 * (nav, floating buttons, services), and each route arrives as its own chunk.
 */
export const routes: Routes = [
  // Public
  {
    path: "auth",
    loadComponent: () => import("./pages/auth.component").then((m) => m.AuthComponent),
    title: `${APP} — Sign in`,
  },
  {
    path: "onboarding",
    canActivate: [authGuard],
    loadComponent: () => import("./pages/onboarding.component").then((m) => m.OnboardingComponent),
    title: `${APP} — Welcome`,
  },
  {
    path: "shared-plan/:token",
    loadComponent: () => import("./pages/shared-plan.component").then((m) => m.SharedPlanComponent),
    title: `${APP} — Shared crisis plan`,
  },

  // Protected
  {
    path: "",
    loadComponent: () => import("./pages/home.component").then((m) => m.HomeComponent),
    canActivate: [authGuard],
    title: `${APP} — Home`,
  },
  {
    path: "mood-check",
    loadComponent: () => import("./pages/mood-check.component").then((m) => m.MoodCheckComponent),
    canActivate: [authGuard],
    title: `${APP} — Mood check-in`,
  },
  {
    path: "journal",
    loadComponent: () => import("./pages/journal.component").then((m) => m.JournalComponent),
    canActivate: [authGuard],
    title: `${APP} — Journal`,
  },
  {
    path: "calendar",
    loadComponent: () => import("./pages/calendar.component").then((m) => m.CalendarComponent),
    canActivate: [authGuard],
    title: `${APP} — Calendar`,
  },
  {
    path: "therapy-sessions",
    loadComponent: () =>
      import("./pages/therapy-sessions.component").then((m) => m.TherapySessionsComponent),
    canActivate: [authGuard],
    title: `${APP} — Therapy sessions`,
  },
  {
    path: "sentiment",
    loadComponent: () => import("./pages/sentiment.component").then((m) => m.SentimentComponent),
    canActivate: [authGuard],
    title: `${APP} — Sentiment`,
  },
  {
    path: "reminders",
    loadComponent: () => import("./pages/reminders.component").then((m) => m.RemindersComponent),
    canActivate: [authGuard],
    title: `${APP} — Reminders`,
  },
  {
    path: "progress",
    loadComponent: () => import("./pages/progress.component").then((m) => m.ProgressComponent),
    canActivate: [authGuard],
    title: `${APP} — Progress`,
  },
  {
    path: "insight",
    loadComponent: () => import("./pages/insight.component").then((m) => m.InsightComponent),
    canActivate: [authGuard],
    title: `${APP} — SIGGY Insight`,
  },
  {
    path: "profile",
    loadComponent: () => import("./pages/profile.component").then((m) => m.ProfileComponent),
    canActivate: [authGuard],
    title: `${APP} — Profile`,
  },
  {
    path: "settings",
    loadComponent: () => import("./pages/settings.component").then((m) => m.SettingsComponent),
    canActivate: [authGuard],
    title: `${APP} — Settings`,
  },
  {
    path: "crisis-plan",
    loadComponent: () => import("./pages/crisis-plan.component").then((m) => m.CrisisPlanComponent),
    canActivate: [authGuard],
    title: `${APP} — Crisis plan`,
  },
  {
    path: "crisis-plan/edit",
    loadComponent: () =>
      import("./pages/crisis-plan-edit.component").then((m) => m.CrisisPlanEditComponent),
    canActivate: [authGuard],
    title: `${APP} — Edit crisis plan`,
  },
  {
    path: "clients",
    loadComponent: () => import("./pages/clients.component").then((m) => m.ClientsComponent),
    canActivate: [authGuard],
    title: `${APP} — Clients`,
  },
  {
    path: "client-profile/:id",
    loadComponent: () =>
      import("./pages/client-profile.component").then((m) => m.ClientProfileComponent),
    canActivate: [authGuard],
    title: `${APP} — Client profile`,
  },
  {
    path: "soap-notes",
    loadComponent: () => import("./pages/soap-notes.component").then((m) => m.SoapNotesComponent),
    canActivate: [authGuard],
    title: `${APP} — SOAP notes`,
  },

  // Catch-all
  {
    path: "**",
    loadComponent: () => import("./pages/not-found.component").then((m) => m.NotFoundComponent),
    title: `${APP} — Not found`,
  },
];
