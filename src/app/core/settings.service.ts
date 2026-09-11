import { computed, DestroyRef, effect, inject, Injectable, signal } from "@angular/core";
import { isDemoMode } from "./demo-session";

export type ThemePreference = "light" | "dark" | "system";

export interface StoredSettings {
  theme: ThemePreference;
  hapticsEnabled: boolean;
  soundEnabled: boolean;
  /** Days before SIGGY gently suggests re-reading the crisis plan. */
  reviewIntervalDays: number;
}

const STORAGE_KEY = isDemoMode() ? "siggy:demo:settings" : "siggy:settings";

function settingsStorage(): Storage { return isDemoMode() ? sessionStorage : localStorage; }

const defaults: StoredSettings = {
  theme: "system",
  hapticsEnabled: true,
  soundEnabled: true,
  reviewIntervalDays: 90,
};

export function normalizeSettings(value: unknown): StoredSettings {
  const raw = value && typeof value === "object" ? value as Partial<StoredSettings> : {};
  return {
    theme: raw.theme === "light" || raw.theme === "dark" || raw.theme === "system" ? raw.theme : defaults.theme,
    hapticsEnabled: typeof raw.hapticsEnabled === "boolean" ? raw.hapticsEnabled : defaults.hapticsEnabled,
    soundEnabled: typeof raw.soundEnabled === "boolean" ? raw.soundEnabled : defaults.soundEnabled,
    reviewIntervalDays: Number.isInteger(raw.reviewIntervalDays) && raw.reviewIntervalDays! >= 1 && raw.reviewIntervalDays! <= 365
      ? raw.reviewIntervalDays! : defaults.reviewIntervalDays,
  };
}

function loadSettings(): StoredSettings {
  try {
    const raw = settingsStorage().getItem(STORAGE_KEY);
    if (!raw) return defaults;
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return defaults;
  }
}

@Injectable({ providedIn: "root" })
export class SettingsService {
  private readonly stored = loadSettings();

  readonly theme = signal<ThemePreference>(this.stored.theme);
  readonly hapticsEnabled = signal<boolean>(this.stored.hapticsEnabled);
  readonly soundEnabled = signal<boolean>(this.stored.soundEnabled);
  readonly reviewIntervalDays = signal<number>(this.stored.reviewIntervalDays);

  private readonly systemDark = signal<boolean>(
    typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches
  );

  readonly resolvedTheme = computed<"light" | "dark">(() =>
    this.theme() === "system" ? (this.systemDark() ? "dark" : "light") : (this.theme() as "light" | "dark")
  );

  constructor() {
    const destroyRef = inject(DestroyRef);
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) => this.systemDark.set(event.matches);
    mql.addEventListener("change", onChange);
    destroyRef.onDestroy(() => mql.removeEventListener("change", onChange));

    // Apply the resolved theme to <html> — Tailwind's `dark:` variants and
    // PrimeNG's darkModeSelector both key off this one class.
    effect(() => {
      document.documentElement.classList.toggle("dark", this.resolvedTheme() === "dark");
    });

    // Persist on any change.
    effect(() => {
      const snapshot: StoredSettings = {
        theme: this.theme(),
        hapticsEnabled: this.hapticsEnabled(),
        soundEnabled: this.soundEnabled(),
        reviewIntervalDays: this.reviewIntervalDays(),
      };
      try {
        settingsStorage().setItem(STORAGE_KEY, JSON.stringify(snapshot));
      } catch {
        // Storage unavailable (private mode etc.) — settings just won't persist.
      }
    });
  }
}
