import { InjectionToken } from "@angular/core";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { environment } from "../../environments/environment";
import { createDemoClient } from "./demo-backend";
import { isDemoMode } from "./demo-session";

const url = environment.supabaseUrl.trim();
const publishableKey = environment.supabasePublishableKey.trim();

/** Refuse missing credentials and server-only keys in a browser bundle. */
export function isSupabaseConfigurationValid(projectUrl: string, key: string): boolean {
  try {
    const parsed = new URL(projectUrl);
    if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/") return false;
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
    if (parsed.protocol !== "https:" && !(local && parsed.protocol === "http:")) return false;
    if (key.startsWith("sb_publishable_")) return key.length > 20;
    const payload = JSON.parse(atob(key.split(".")[1]?.replace(/-/g, "+").replace(/_/g, "/") ?? ""));
    return payload.role === "anon";
  } catch {
    return false;
  }
}

export const supabaseConfigured = isSupabaseConfigurationValid(url, publishableKey);

// No storage access at module evaluation: private-mode browsers can throw even
// when reading window.localStorage. Supabase already tolerates unavailable storage.
export const supabase = isDemoMode() ? createDemoClient() : createClient(
  supabaseConfigured ? url : "https://placeholder-project.supabase.co",
  supabaseConfigured ? publishableKey : "placeholder-publishable-key",
  {
    auth: {
      persistSession: supabaseConfigured,
      autoRefreshToken: supabaseConfigured,
      detectSessionInUrl: supabaseConfigured,
    },
  }
);

export const SUPABASE_CLIENT = new InjectionToken<SupabaseClient>("Supabase client", {
  providedIn: "root",
  factory: () => supabase,
});
export const SUPABASE_CONFIGURED = new InjectionToken<boolean>("Supabase configured", {
  providedIn: "root",
  factory: () => supabaseConfigured || isDemoMode(),
});
