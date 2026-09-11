import { DestroyRef, inject, Injectable, signal } from "@angular/core";
import { QueryClient } from "@tanstack/angular-query-experimental";
import type { Session, User } from "@supabase/supabase-js";
import { SUPABASE_CLIENT, SUPABASE_CONFIGURED } from "./supabase.client";
import { exitDemo, isDemoMode } from "./demo-session";

@Injectable({ providedIn: "root" })
export class AuthService {
  private readonly client = inject(SUPABASE_CLIENT);
  private readonly configured = inject(SUPABASE_CONFIGURED);
  private readonly queryClient = inject(QueryClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly _user = signal<User | null>(null);
  private readonly _session = signal<Session | null>(null);
  private readonly _loading = signal(true);
  private readonly _error = signal<string | null>(null);

  readonly user = this._user.asReadonly();
  readonly session = this._session.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  /** Always settles, including a failed session lookup, so guards cannot hang. */
  readonly ready: Promise<void>;

  constructor() {
    let resolveReady!: () => void;
    this.ready = new Promise<void>((resolve) => (resolveReady = resolve));
    if (!this.configured) {
      this._loading.set(false);
      resolveReady();
      return;
    }

    let authEventReceived = false;
    let destroyed = false;
    const finish = (session: Session | null) => {
      if (destroyed) return;
      this.applySession(session);
      this._loading.set(false);
      resolveReady();
    };
    const { data: { subscription } } = this.client.auth.onAuthStateChange((_event, session) => {
      authEventReceived = true;
      this._error.set(null);
      finish(session);
    });
    this.destroyRef.onDestroy(() => {
      destroyed = true;
      subscription.unsubscribe();
      resolveReady();
    });

    void this.client.auth.getSession().then(({ data, error }) => {
      // A stale startup response must never restore an account after SIGNED_OUT
      // or overwrite a newer SIGNED_IN / token refresh event.
      if (authEventReceived || destroyed) return;
      if (error) this._error.set("Your session could not be restored. Please sign in again.");
      finish(error ? null : data.session);
    }).catch(() => {
      if (authEventReceived || destroyed) return;
      this._error.set("Your session could not be restored. Please sign in again.");
      finish(null);
    });
  }

  requireUserId(): string {
    const id = this.user()?.id;
    if (!id) throw new Error("You need to be signed in.");
    return id;
  }

  assertUser(userId: string): void {
    if (this.user()?.id !== userId) throw new Error("Your session changed. Please try again.");
  }

  async signOut(): Promise<void> {
    const { error } = await this.client.auth.signOut();
    if (error) throw new Error(error.message);
    this.applySession(null);
    if (isDemoMode()) exitDemo();
  }

  private applySession(session: Session | null): void {
    if (this._user()?.id !== session?.user.id) {
      // Clearing also cancels outstanding queries. Their AbortSignals are
      // passed to Supabase reads so a previous account cannot repopulate cache.
      this.queryClient.clear();
    }
    this._session.set(session);
    this._user.set(session?.user ?? null);
  }
}
