import { Component, computed, effect, inject, signal } from "@angular/core";
import { DatePipe } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { Router, RouterLink, NavigationEnd } from "@angular/router";
import { toSignal } from "@angular/core/rxjs-interop";
import { filter, map } from "rxjs";
import { DialogModule } from "primeng/dialog";
import { AuthService } from "../core/auth.service";
import { RoleService } from "../core/role.service";
import { TherapyService } from "../core/therapy.service";
import { isSessionDue, PRE_SESSION_NOTE_LIMIT, PreSessionNote, TherapySession } from "../core/therapy.types";
import { isDemoMode } from "../core/demo-session";

/** Stores reminder timing only. Note contents are never put in browser storage outside demo mode. */
export function sessionPromptKey(session: TherapySession): string {
  return `${session.id}:${session.starts_at}`;
}

@Component({
  selector: "app-session-check-in",
  standalone: true,
  imports: [DialogModule, FormsModule, DatePipe, RouterLink],
  template: `
    <p-dialog header="Before your session" [visible]="visible()" [modal]="true"
      [closable]="false" [closeOnEscape]="false" [dismissableMask]="false" appendTo="body"
      [style]="{ width: '36rem', maxWidth: 'calc(100vw - 2rem)', maxHeight: 'calc(100dvh - 2rem)' }"
      [contentStyle]="{ overflowY: 'auto' }">
      @if (therapy.editorSession(); as editor) {
        <div class="space-y-4">
          <p class="text-sm text-muted-foreground">
            {{ editor.session.starts_at | date:'EEE, MMM d, h:mm a' }} · {{ therapistName() }}
          </p>
          <h2 class="text-xl leading-snug">Is there anything you would like your therapist to know?</h2>
          <p class="text-sm text-muted-foreground">You can share what has been on your mind, a change since your last visit, or something you want to discuss.</p>
          <div>
            <label for="pre-session-body" class="mb-2 block text-sm font-semibold">Note for your therapist</label>
            <textarea id="pre-session-body" [ngModel]="body()" (ngModelChange)="body.set($event)"
              rows="6" [maxLength]="limit" [disabled]="saving()" [readOnly]="unavailable() || noteUnavailable()"
              aria-describedby="pre-session-count pre-session-privacy"
              placeholder="I would like to talk about…"
              class="w-full resize-y rounded-xl border border-border bg-background p-3 text-base leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"></textarea>
            <p id="pre-session-count" class="mt-1 text-right text-xs text-muted-foreground">{{ body().length }} / {{ limit }}</p>
          </div>
          <p id="pre-session-privacy" class="rounded-xl bg-accent/60 p-3 text-sm">
            @if (alreadyShared()) {
              This note is shared with {{ therapistName() }}. Saving an update makes it available for review again.
            } @else {
              Your draft stays private until you choose “Share with therapist.” Only {{ therapistName() }} can review your shared note.
            }
            @if (demo) { <span class="mt-1 block font-medium">Demo: this note stays in this tab and is not sent to a real therapist.</span> }
          </p>
          <p class="text-xs leading-relaxed text-muted-foreground">Notes may not be read before your session. For urgent help, contact emergency services or use <a routerLink="/crisis-plan" (click)="closeForHelp()" class="font-semibold text-primary underline">your crisis plan</a>.</p>
          @if (unavailable()) {
            <p role="alert" class="text-sm text-destructive">This session is no longer available for editing. Your text is still here so you can copy it.</p>
          }
          @if (therapy.notesQuery.isPending()) { <p role="status" class="text-sm">Loading your saved note…</p> }
          @if (therapy.notesQuery.isError()) {
            <div role="alert" class="text-sm text-destructive">
              <p>Your saved note could not be loaded. Retry before editing so it isn't overwritten.</p>
              <button type="button" [class]="secondary" (click)="therapy.notesQuery.refetch()">Retry loading note</button>
            </div>
          }
          @if (error()) { <p role="alert" class="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{{ error() }}</p> }
          @if (conflict()) {
            <div class="rounded-xl border border-primary/30 p-3 text-sm">
              <p class="font-semibold">Your text is still in the box above.</p>
              @if (conflictNote(); as latest) {
                <p class="mt-2 text-muted-foreground">Compare it with the latest saved version:</p>
                <blockquote class="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-muted p-3">{{ latest.body }}</blockquote>
                <div class="mt-3 flex flex-wrap gap-2">
                  <button type="button" [class]="secondary" (click)="resolveConflict(false)">Keep my text</button>
                  <button type="button" [class]="secondary" (click)="resolveConflict(true)">Load saved version</button>
                </div>
                <p class="mt-2 text-xs text-muted-foreground">Keeping your text does not save or share it until you choose a save button.</p>
              } @else {
                <button type="button" [class]="secondary" (click)="loadConflict()">Load latest note</button>
              }
            </div>
          }
        </div>
      }
      <ng-template #footer>
        <div class="w-full border-t border-border pt-4">
          @if (confirmDiscard()) {
            <div role="alert" class="rounded-xl border border-border p-3 text-sm">
              <p>You have unsaved changes. Save your note or keep writing before leaving.</p>
              <div class="mt-2 flex flex-wrap gap-2">
                <button type="button" [class]="secondary" (click)="confirmDiscard.set(false)">Keep writing</button>
                <button type="button" [class]="secondary" (click)="dismiss()">Discard unsaved changes</button>
              </div>
            </div>
          } @else {
            <div class="flex flex-wrap justify-end gap-2">
              <button type="button" [class]="secondary" [disabled]="saving()" (click)="requestDismiss()">Not now</button>
              @if (!alreadyShared()) {
                <button type="button" [class]="secondary" [disabled]="saving() || unavailable() || noteUnavailable() || conflict() || !body().trim()" (click)="save(false)">Save private draft</button>
              }
              <button type="button" class="min-h-[44px] rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                [disabled]="saving() || unavailable() || noteUnavailable() || conflict() || !body().trim()" (click)="save(true)">
                {{ saving() ? 'Saving…' : alreadyShared() ? 'Update shared note' : 'Share with therapist' }}
              </button>
            </div>
          }
        </div>
      </ng-template>
    </p-dialog>
  `,
})
export class SessionCheckInComponent {
  readonly therapy = inject(TherapyService);
  private readonly auth = inject(AuthService);
  private readonly role = inject(RoleService);
  private readonly router = inject(Router);
  readonly demo = isDemoMode();
  readonly limit = PRE_SESSION_NOTE_LIMIT;
  readonly body = signal("");
  readonly original = signal("");
  readonly saving = signal(false);
  readonly error = signal("");
  readonly confirmDiscard = signal(false);
  readonly conflict = signal(false);
  readonly conflictNote = signal<PreSessionNote | null>(null);
  private revision: string | null = null;
  private readonly snoozed = new Map<string, Record<string, number>>();
  private readonly url = toSignal(this.router.events.pipe(
    filter((event): event is NavigationEnd => event instanceof NavigationEnd), map(() => this.router.url)
  ), { initialValue: this.router.url });
  readonly secondary = "min-h-[44px] rounded-xl border border-border px-4 py-2 text-sm font-semibold hover:bg-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  readonly visible = computed(() => {
    const editor = this.therapy.editorSession();
    return !!editor && editor.userId === this.auth.user()?.id && !this.role.isClinician();
  });
  readonly therapistName = computed(() => this.therapy.connectionsQuery.data()?.find(
    connection => connection.id === this.therapy.editorSession()?.session.connection_id
  )?.therapist_name ?? "your connected therapist");
  readonly alreadyShared = computed(() => this.therapy.notesBySession().get(this.therapy.editorSession()?.session.id ?? "")?.status === "submitted");
  readonly noteUnavailable = computed(() => this.therapy.notesQuery.isPending() || this.therapy.notesQuery.isError());
  readonly unavailable = computed(() => {
    const editor = this.therapy.editorSession();
    return !!editor && !this.therapy.upcomingSessions().some(session => session.id === editor.session.id);
  });

  constructor() {
    effect(() => {
      const editor = this.therapy.editorSession();
      const userId = this.auth.user()?.id;
      const clinician = this.role.isClinician();
      if (!editor || editor.userId !== userId || clinician) {
        this.body.set(""); this.original.set(""); this.error.set(""); this.confirmDiscard.set(false);
        this.conflict.set(false); this.conflictNote.set(null);
        if (editor) this.therapy.closeNote();
        return;
      }
      if (this.noteUnavailable()) return;
      // Snapshot only when opening. Background refetches must not overwrite a draft being typed.
      const note = this.therapy.notesBySession().get(editor.session.id);
      this.initializeEditor(editor, note?.body ?? "", note?.updated_at ?? null);
    });
    effect(() => {
      const now = this.therapy.now();
      const userId = this.auth.user()?.id;
      const url = this.url();
      const sessions = this.therapy.upcomingSessions();
      const notes = this.therapy.notesBySession();
      if (!userId || this.role.isClinician() || this.therapy.editorSession() ||
        /^\/(auth|onboarding|shared-plan)(\/|\?|$)/.test(url) ||
        this.therapy.notesQuery.isPending() || this.therapy.notesQuery.isError() ||
        this.therapy.sessionsQuery.isError() || this.therapy.connectionsQuery.isError() ||
        (typeof document !== "undefined" && document.visibilityState !== "visible")) return;
      const dismissals = this.readSnoozes(userId);
      const due = sessions.find(session => isSessionDue(session, now) &&
        notes.get(session.id)?.status !== "submitted" && (dismissals[sessionPromptKey(session)] ?? 0) <= now);
      if (due) {
        this.snooze(userId, due);
        this.therapy.openNote(due);
      }
    });
  }

  private initialized: { session: TherapySession; userId: string } | null = null;
  private initializeEditor(editor: { session: TherapySession; userId: string }, value: string, revision: string | null) {
    if (this.initialized === editor) return;
    this.initialized = editor;
    this.revision = revision;
    this.body.set(value); this.original.set(value); this.error.set(""); this.confirmDiscard.set(false);
    this.conflict.set(false); this.conflictNote.set(null);
  }

  requestDismiss(): void {
    if (this.saving()) return;
    if (this.body() !== this.original()) this.confirmDiscard.set(true);
    else this.dismiss();
  }

  dismiss(): void {
    const editor = this.therapy.editorSession();
    if (editor) this.snooze(editor.userId, editor.session);
    this.therapy.closeNote();
  }

  closeForHelp(): void { this.dismiss(); }

  async save(submit: boolean): Promise<void> {
    const editor = this.therapy.editorSession();
    if (!editor || this.saving() || this.unavailable() || this.noteUnavailable() || this.conflict()) return;
    this.saving.set(true); this.error.set("");
    try {
      await this.therapy.saveNote(editor.session.id, this.body(), submit, this.revision);
      if (this.therapy.editorSession() === editor) this.dismiss();
    } catch (error) {
      if (this.therapy.editorSession() === editor) this.error.set(error instanceof Error ? error.message : "Your note could not be saved. Your text is still here; please try again.");
      if (this.therapy.editorSession() === editor && error instanceof Error && "code" in error && error.code === "40001") {
        this.conflict.set(true);
        await this.loadConflict();
      }
    } finally { this.saving.set(false); }
  }

  async loadConflict(): Promise<void> {
    const editor = this.therapy.editorSession();
    if (!editor) return;
    const result = await this.therapy.notesQuery.refetch();
    if (this.therapy.editorSession() === editor && !result.isError) this.conflictNote.set(result.data?.find(note => note.session_id === editor.session.id) ?? null);
  }

  resolveConflict(loadSaved: boolean): void {
    const latest = this.conflictNote();
    if (!latest) return;
    this.revision = latest.updated_at;
    this.original.set(latest.body);
    if (loadSaved) this.body.set(latest.body);
    this.conflict.set(false); this.conflictNote.set(null); this.error.set("");
  }

  private storageKey(userId: string): string { return `${this.demo ? 'siggy:demo:' : 'siggy:'}pre-session:${userId}`; }

  private readSnoozes(userId: string): Record<string, number> {
    try {
      const storage = this.demo ? sessionStorage : localStorage;
      const parsed = JSON.parse(storage.getItem(this.storageKey(userId)) ?? "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const entries = Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1])));
        for (const [key, until] of Object.entries(this.snoozed.get(userId) ?? {})) entries[key] = Math.max(entries[key] ?? 0, until);
        return entries;
      }
    } catch { /* In-memory fallback keeps blocked storage from interrupting the check-in. */ }
    return this.snoozed.get(userId) ?? {};
  }

  private snooze(userId: string, session: TherapySession): void {
    const now = Date.now();
    const entries = Object.fromEntries(Object.entries(this.readSnoozes(userId)).filter(([, until]) => until > now).slice(-99));
    entries[sessionPromptKey(session)] = now + 60 * 60 * 1000;
    this.snoozed.set(userId, entries);
    try { (this.demo ? sessionStorage : localStorage).setItem(this.storageKey(userId), JSON.stringify(entries)); } catch { /* Memory remains available. */ }
  }
}
