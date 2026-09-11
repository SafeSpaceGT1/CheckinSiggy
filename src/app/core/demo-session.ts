/** Demo state is confined to this tab and never uses live account storage. */
export const DEMO_USER_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
export const DEMO_DATA_KEY = "siggy:demo:data:v1";
export const DEMO_AUTH_KEY = "siggy:demo:auth:v1";
const ACTIVE_KEY = "siggy:demo:active";

function initialDemoMode(): boolean {
  if (typeof window === "undefined") return false;
  const requested = new URL(window.location.href).searchParams.get("demo");
  if (requested === "1") {
    try { sessionStorage.setItem(ACTIVE_KEY, "1"); } catch { /* This load still works in memory. */ }
    return true;
  }
  try { return sessionStorage.getItem(ACTIVE_KEY) === "1"; } catch { return false; }
}

const active = initialDemoMode();
export function isDemoMode(): boolean { return active; }

function appUrl(path: string, demo = false): string {
  const url = new URL(path, document.baseURI);
  if (demo) url.searchParams.set("demo", "1");
  return url.href;
}

/** A reload constructs a fresh client, so live and demo requests never mix. */
export function enterDemo(): void {
  try { sessionStorage.setItem(ACTIVE_KEY, "1"); } catch { /* URL is the fallback. */ }
  window.location.assign(appUrl("", true));
}

function clearDemoState(): void {
  try {
    const keys = Array.from({ length: sessionStorage.length }, (_, i) => sessionStorage.key(i));
    for (const key of keys) if (key?.startsWith("siggy:demo:")) sessionStorage.removeItem(key);
  } catch { /* The next document starts with fresh in-memory data. */ }
}

export function resetDemo(): void {
  clearDemoState();
  enterDemo();
}

export function exitDemo(): void {
  clearDemoState();
  window.location.assign(appUrl("auth"));
}
