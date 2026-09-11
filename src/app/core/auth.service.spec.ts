import { TestBed } from "@angular/core/testing";
import { QueryClient, provideTanStackQuery } from "@tanstack/angular-query-experimental";
import type { Session } from "@supabase/supabase-js";
import { AuthService } from "./auth.service";
import { SUPABASE_CLIENT, SUPABASE_CONFIGURED, isSupabaseConfigurationValid } from "./supabase.client";

describe("AuthService session lifecycle", () => {
  let client: QueryClient;
  let notify: (event: string, session: Session | null) => void;
  let resolveSession: (result: { data: { session: Session | null }; error: { message: string } | null }) => void;
  let rejectSession: (error: Error) => void;
  let unsubscribe: jasmine.Spy;
  let auth: { onAuthStateChange: jasmine.Spy; getSession: jasmine.Spy; signOut: jasmine.Spy };
  const session = (id: string) => ({ user: { id }, access_token: id } as Session);

  beforeEach(() => {
    client = new QueryClient();
    unsubscribe = jasmine.createSpy("unsubscribe");
    const pending = new Promise((resolve, reject) => { resolveSession = resolve; rejectSession = reject; });
    auth = {
      onAuthStateChange: jasmine.createSpy().and.callFake((callback) => {
        notify = callback;
        return { data: { subscription: { unsubscribe } } };
      }),
      getSession: jasmine.createSpy().and.returnValue(pending),
      signOut: jasmine.createSpy().and.resolveTo({ error: null }),
    };
    TestBed.configureTestingModule({ providers: [provideTanStackQuery(client),
      { provide: SUPABASE_CLIENT, useValue: { auth } }, { provide: SUPABASE_CONFIGURED, useValue: true }] });
  });
  afterEach(() => { client.clear(); TestBed.resetTestingModule(); });

  it("does not restore a stale startup session after a sign-out event", async () => {
    const service = TestBed.inject(AuthService);
    notify("SIGNED_OUT", null);
    resolveSession({ data: { session: session("old-user") }, error: null });
    await service.ready;
    await Promise.resolve();
    expect(service.user()).toBeNull();
    expect(service.loading()).toBeFalse();
  });

  it("settles readiness when session lookup rejects", async () => {
    const service = TestBed.inject(AuthService);
    rejectSession(new Error("Offline"));
    await service.ready;
    expect(service.user()).toBeNull();
    expect(service.loading()).toBeFalse();
    expect(service.error()).toContain("could not be restored");
  });

  it("settles readiness when Supabase returns an auth error", async () => {
    const service = TestBed.inject(AuthService);
    resolveSession({ data: { session: null }, error: { message: "Invalid refresh token" } });
    await service.ready;
    expect(service.loading()).toBeFalse();
    expect(service.error()).toBeTruthy();
  });

  it("clears private caches on account change but keeps them on token refresh", async () => {
    const service = TestBed.inject(AuthService);
    notify("SIGNED_IN", session("first"));
    await service.ready;
    client.setQueryData(["journal-entries", "first"], [{ content: "Private" }]);
    notify("TOKEN_REFRESHED", session("first"));
    expect(client.getQueryData(["journal-entries", "first"])).toBeDefined();
    notify("SIGNED_IN", session("second"));
    expect(client.getQueryCache().getAll()).toEqual([]);
    expect(service.user()?.id).toBe("second");
  });

  it("reports failed sign-out and preserves the active session", async () => {
    const service = TestBed.inject(AuthService);
    notify("SIGNED_IN", session("first"));
    auth.signOut.and.resolveTo({ error: { message: "Offline" } });
    await expectAsync(service.signOut()).toBeRejectedWithError("Offline");
    expect(service.user()?.id).toBe("first");
  });

  it("performs no auth bootstrap calls without configuration", async () => {
    TestBed.overrideProvider(SUPABASE_CONFIGURED, { useValue: false });
    const service = TestBed.inject(AuthService);
    await service.ready;
    expect(auth.getSession).not.toHaveBeenCalled();
    expect(auth.onAuthStateChange).not.toHaveBeenCalled();
    expect(service.loading()).toBeFalse();
  });

  it("unsubscribes from auth events when destroyed", () => {
    TestBed.inject(AuthService);
    TestBed.resetTestingModule();
    expect(unsubscribe).toHaveBeenCalledOnceWith();
  });
});

describe("Supabase browser credentials", () => {
  it("rejects secret/service keys and non-HTTPS public project URLs", () => {
    const jwt = `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify({ role: "service_role" }))}.signature`;
    expect(isSupabaseConfigurationValid("https://example.supabase.co", jwt)).toBeFalse();
    expect(isSupabaseConfigurationValid("https://example.supabase.co", "sb_secret_12345678901234567890")).toBeFalse();
    expect(isSupabaseConfigurationValid("http://example.supabase.co", "sb_publishable_12345678901234567890")).toBeFalse();
  });
  it("rejects URLs containing embedded credentials, paths or parameters", () => {
    for (const url of ["https://user:password@example.supabase.co", "https://example.supabase.co/path",
      "https://example.supabase.co?token=x", "https://example.supabase.co#fragment"]) {
      expect(isSupabaseConfigurationValid(url, "sb_publishable_12345678901234567890")).toBeFalse();
    }
  });
  it("accepts browser publishable keys and localhost development", () => {
    expect(isSupabaseConfigurationValid("https://example.supabase.co", "sb_publishable_12345678901234567890")).toBeTrue();
    expect(isSupabaseConfigurationValid("http://127.0.0.1:54321", "sb_publishable_12345678901234567890")).toBeTrue();
  });
});
