import { Injectable, inject } from "@angular/core";
import { SettingsService } from "./settings.service";

export type FeedbackType = "tap" | "success" | "error" | "warning";

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  try {
    if (!audioCtx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      audioCtx = new Ctor();
    }
    if (audioCtx.state === "suspended") {
      void audioCtx.resume();
    }
    return audioCtx;
  } catch {
    return null;
  }
}

function playTone(frequency: number, durationMs: number, delayMs = 0, volume = 0.05) {
  const ctx = getAudioContext();
  if (!ctx) return;
  const start = ctx.currentTime + delayMs / 1000;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + durationMs / 1000);
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(start + durationMs / 1000 + 0.05);
}

const SOUNDS: Record<FeedbackType, () => void> = {
  tap: () => playTone(880, 60),
  success: () => {
    playTone(659, 90);
    playTone(988, 140, 90);
  },
  error: () => playTone(220, 200),
  warning: () => {
    playTone(440, 110);
    playTone(440, 110, 150);
  },
};

const VIBRATIONS: Record<FeedbackType, number | number[]> = {
  tap: 10,
  success: [15, 40, 25],
  error: [40, 60, 40],
  warning: [25, 40, 25],
};

/**
 * Small sound + haptic cues. Both channels respect the user's Settings toggles.
 */
@Injectable({ providedIn: "root" })
export class FeedbackService {
  private readonly settings = inject(SettingsService);

  trigger(type: FeedbackType) {
    if (this.settings.soundEnabled()) {
      try {
        SOUNDS[type]();
      } catch {
        // Audio unavailable — silently skip.
      }
    }
    if (this.settings.hapticsEnabled() && typeof navigator !== "undefined" && "vibrate" in navigator) {
      try {
        navigator.vibrate(VIBRATIONS[type]);
      } catch {
        // Vibration unavailable — silently skip.
      }
    }
  }
}
