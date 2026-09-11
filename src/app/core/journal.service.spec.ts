import { signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { provideTanStackQuery, QueryClient } from "@tanstack/angular-query-experimental";
import { AuthService } from "./auth.service";
import { JournalService } from "./journal.service";
import { supabase } from "./supabase.client";

describe("journal persistence and analysis", () => {
  let service: JournalService;
  let client: QueryClient;
  let user: ReturnType<typeof signal<{ id: string } | null>>;
  let insert: jasmine.Spy;
  let upsert: jasmine.Spy;
  let eq: jasmine.Spy;
  let remove: jasmine.Spy;
  let invoke: jasmine.Spy;
  const saved = { id: "saved-entry", content: "I feel calm and grateful", mood: null,
    created_at: "2026-09-11T12:00:00Z", updated_at: "2026-09-11T12:00:00Z" };

  beforeEach(() => {
    user = signal<{ id: string } | null>({ id: "journal-owner" });
    const builder = {
      select: jasmine.createSpy(), order: jasmine.createSpy(), abortSignal: jasmine.createSpy(), limit: jasmine.createSpy(),
      insert: jasmine.createSpy(), upsert: jasmine.createSpy().and.resolveTo({ error: null }),
      delete: jasmine.createSpy(), eq: jasmine.createSpy(), single: jasmine.createSpy().and.resolveTo({ data: saved, error: null }),
      then: (resolve: (response: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
    };
    for (const method of [builder.select, builder.order, builder.limit, builder.abortSignal, builder.insert, builder.delete, builder.eq]) method.and.returnValue(builder);
    ({ insert, upsert, eq } = builder);
    remove = builder.delete;
    spyOn(supabase, "from").and.returnValue(builder as never);
    const functions = supabase.functions;
    spyOnProperty(supabase, "functions", "get").and.returnValue(functions);
    invoke = spyOn(functions, "invoke").and.resolveTo({ data: null, error: new Error("AI unavailable") });
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    // Test the mutation contract separately from the already-covered query engine.
    spyOn(client, "invalidateQueries").and.resolveTo();
    TestBed.configureTestingModule({ providers: [provideTanStackQuery(client), { provide: AuthService, useValue: {
      user, requireUserId: () => { if (!user()) throw new Error("Signed out"); return user()!.id; },
      assertUser: (id: string) => { if (id !== user()?.id) throw new Error("Your session changed."); },
    } }] });
    service = TestBed.inject(JournalService);
  });
  afterEach(() => { client.clear(); TestBed.resetTestingModule(); });

  it("can analyze a newly saved journal locally before a history refetch", async () => {
    const id = await service.saveMutation.mutateAsync({ content: saved.content, mood: null });
    expect(id).toBe(saved.id);
    expect(client.getQueryData(["journal-entries", "journal-owner"])).toEqual([saved]);
    expect(await service.analyze(id)).toBe("local");
    expect(upsert).toHaveBeenCalledWith(jasmine.objectContaining({ journal_entry_id: saved.id, user_id: "journal-owner", source: "local" }), { onConflict: "journal_entry_id" });
    expect(service.analyzingIds().size).toBe(0);
  });

  it("does not save whitespace-only journal content", async () => {
    await expectAsync(service.saveMutation.mutateAsync({ content: " \n ", mood: null })).toBeRejectedWithError(/required/);
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects local fallback when the account changes while AI is pending", async () => {
    await service.saveMutation.mutateAsync({ content: saved.content, mood: null });
    invoke.and.callFake(async () => { user.set({ id: "other-account" }); return { data: null, error: new Error("AI unavailable") }; });
    await expectAsync(service.analyze(saved.id)).toBeRejectedWithError(/session changed/);
    expect(upsert).not.toHaveBeenCalled();
    expect(service.analyzingIds().size).toBe(0);
  });

  it("does not turn authorization errors into a local analysis write", async () => {
    await service.saveMutation.mutateAsync({ content: saved.content, mood: null });
    invoke.and.resolveTo({ data: null, error: { context: { status: 403 } } });
    await expectAsync(service.analyze(saved.id)).toBeRejectedWithError(/unavailable/);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("scopes journal deletion to both record and owner", async () => {
    await service.deleteMutation.mutateAsync(saved.id);
    expect(eq).toHaveBeenCalledWith("id", saved.id);
    expect(eq).toHaveBeenCalledWith("user_id", "journal-owner");
    user.set(null);
    remove.calls.reset();
    await expectAsync(service.deleteMutation.mutateAsync(saved.id)).toBeRejected();
    expect(remove).not.toHaveBeenCalled();
  });
});
