import { type ApplicationConfig, provideZoneChangeDetection } from "@angular/core";
import {
  provideRouter,
  withComponentInputBinding,
  withInMemoryScrolling,
} from "@angular/router";
import { providePrimeNG } from "primeng/config";
import { ConfirmationService, MessageService } from "primeng/api";
import { provideTanStackQuery, QueryClient } from "@tanstack/angular-query-experimental";
import { routes } from "./app.routes";
import { SiggyPreset } from "./theme/siggy-preset";

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: "top" })
    ),
    providePrimeNG({
      theme: {
        preset: SiggyPreset,
        options: {
          darkModeSelector: ".dark",
        },
      },
      ripple: true,
    }),
    provideTanStackQuery(
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      })
    ),
    MessageService,
    ConfirmationService,
  ],
};
