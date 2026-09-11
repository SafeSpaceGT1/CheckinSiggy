import { computed, DestroyRef, inject, Injectable, signal } from "@angular/core";
import { injectQuery, QueryClient } from "@tanstack/angular-query-experimental";
import { AuthService } from "./auth.service";
import { RoleService } from "./role.service";
import { SUPABASE_CLIENT } from "./supabase.client";
import {
  PreSessionNote, SessionInput, TherapyConnection, TherapyInvite, TherapySession,
  validatePreSessionNote, validateSessionInput,
} from "./therapy.types";

function readableError(error: { message: string; code?: string }): Error {
  if (["PGRST202", "PGRST205", "42P01"].includes(error.code ?? "")) {
    return new Error("Therapy sessions are not available on this server yet. The app administrator needs to apply the therapy sessions update.");
  }
  return Object.assign(new Error(error.message), { code: error.code });
}

@Injectable({ providedIn: "root" })
export class TherapyService {
  private readonly auth = inject(AuthService);
  private readonly role = inject(RoleService);
  private readonly client = inject(SUPABASE_CLIENT);
  private readonly cache = inject(QueryClient);
  private readonly destroyRef = inject(DestroyRef);
  readonly now = signal(Date.now());
  readonly editorSession = signal<{ session: TherapySession; userId: string } | null>(null);

  readonly connectionsQuery = this.query<TherapyConnection>("therapy_connections");
  readonly sessionsQuery = this.query<TherapySession>("therapy_sessions");
  readonly notesQuery = this.query<PreSessionNote>("pre_session_notes");
  readonly activeConnections = computed(() =>
    (this.connectionsQuery.data() ?? []).filter(connection => !connection.revoked_at && !!connection.user_id));
  readonly upcomingSessions = computed(() => {
    const active = new Set(this.activeConnections().map(connection => connection.id));
    return (this.sessionsQuery.data() ?? []).filter(session =>
      session.status === "scheduled" && Date.parse(session.starts_at) > this.now() && active.has(session.connection_id)
    ).sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  });
  readonly notesBySession = computed(() => new Map((this.notesQuery.data() ?? []).map(note => [note.session_id, note])));

  constructor() {
    if (typeof window !== "undefined") {
      const tick = () => this.now.set(Date.now());
      const refresh = () => {
        tick();
        if (document.visibilityState === "visible" && this.auth.user()) void this.refresh();
      };
      const interval = setInterval(tick, 30_000);
      document.addEventListener("visibilitychange", refresh);
      window.addEventListener("focus", refresh);
      this.destroyRef.onDestroy(() => {
        clearInterval(interval);
        document.removeEventListener("visibilitychange", refresh);
        window.removeEventListener("focus", refresh);
      });
    }
  }

  private query<T>(table: "therapy_connections" | "therapy_sessions" | "pre_session_notes") {
    return injectQuery(() => ({
      queryKey: ["therapy", table, this.auth.user()?.id, this.role.isClinician() ? "therapist" : "client"],
      enabled: !!this.auth.user(),
      staleTime: 30_000,
      refetchInterval: 60_000,
      refetchIntervalInBackground: false,
      queryFn: async ({ queryKey, signal }: { queryKey: readonly unknown[]; signal: AbortSignal }): Promise<T[]> => {
        const ownerId = queryKey[2] as string;
        const clinician = queryKey[3] === "therapist";
        this.auth.assertUser(ownerId);
        const rows: T[] = [];
        // Stable pagination avoids silently dropping an upcoming session or a note.
        for (let offset = 0; ; offset += 500) {
          let request = this.client.from(table).select("*")
            .order(table === "pre_session_notes" ? "session_id" : "id", { ascending: true })
            .range(offset, offset + 499).abortSignal(signal);
          if (table === "pre_session_notes") {
            request = clinician ? request.eq("status", "submitted") : request.eq("user_id", ownerId);
          } else {
            request = request.eq(clinician ? "therapist_id" : "user_id", ownerId);
          }
          const { data, error } = await request;
          if (error) throw readableError(error);
          this.auth.assertUser(ownerId);
          rows.push(...(data ?? []) as T[]);
          if (!data || data.length < 500) return rows;
        }
      },
    }));
  }

  async refresh(): Promise<void> {
    await this.cache.invalidateQueries({ queryKey: ["therapy"] });
  }

  private async rpc<T>(name: string, args: Record<string, unknown>, invalidate = true): Promise<T> {
    const userId = this.auth.requireUserId();
    const { data, error } = await this.client.rpc(name, args);
    this.auth.assertUser(userId);
    if (error) throw readableError(error);
    if (data == null) throw new Error("The request could not be completed. Refresh and try again.");
    if (invalidate) await this.refresh();
    this.auth.assertUser(userId);
    return data as T;
  }

  createInvite(clientId: string, therapistName: string): Promise<TherapyInvite> {
    const name = therapistName.trim();
    if (!clientId || !name || name.length > 120) return Promise.reject(new Error("Choose a client and enter your name (up to 120 characters)."));
    return this.rpc("create_therapy_invite", { p_client_id: clientId, p_therapist_name: name });
  }

  previewInvite(token: string): Promise<{ therapist_name: string; expires_at: string }> {
    return this.rpc("preview_therapy_invite", { p_token: this.inviteToken(token) }, false);
  }

  acceptInvite(token: string): Promise<TherapyConnection> {
    return this.rpc("accept_therapy_invite", { p_token: this.inviteToken(token) });
  }

  private inviteToken(token: string): string {
    const value = token.trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
      throw new Error("Enter the full invitation code your therapist gave you.");
    }
    return value;
  }

  revokeConnection(id: string): Promise<TherapyConnection> {
    return this.rpc("revoke_therapy_connection", { p_connection_id: id });
  }

  saveSession(payload: SessionInput): Promise<TherapySession> {
    const input = validateSessionInput(payload);
    return this.rpc("save_therapy_session", { p_connection_id: input.connection_id,
      p_starts_at: input.starts_at, p_duration_minutes: input.duration_minutes, p_session_id: input.id ?? null });
  }

  cancelSession(id: string): Promise<TherapySession> {
    return this.rpc("cancel_therapy_session", { p_session_id: id });
  }

  saveNote(id: string, body: string, submit: boolean, expectedUpdatedAt: string | null): Promise<PreSessionNote> {
    return this.rpc("save_pre_session_note", { p_session_id: id, p_body: validatePreSessionNote(body), p_submit: submit, p_expected_updated_at: expectedUpdatedAt });
  }

  markReviewed(id: string, expectedUpdatedAt: string): Promise<PreSessionNote> {
    return this.rpc("mark_pre_session_note_reviewed", { p_session_id: id, p_expected_updated_at: expectedUpdatedAt });
  }

  openNote(session: TherapySession): void {
    const userId = this.auth.requireUserId();
    if (this.role.isClinician() || session.user_id !== userId || session.status !== "scheduled" || Date.parse(session.starts_at) <= Date.now()) return;
    this.editorSession.set({ session, userId });
  }

  closeNote(): void { this.editorSession.set(null); }
}
