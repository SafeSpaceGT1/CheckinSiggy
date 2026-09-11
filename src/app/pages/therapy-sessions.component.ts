import { Component, computed, effect, inject, signal, untracked } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { format } from "date-fns";
import { CalendarDays, Check, ChevronRight, Clock3, Link2, LockKeyhole, LucideAngularModule, MessageCircle, Plus, Sparkles, Users } from "lucide-angular";
import { ButtonModule } from "primeng/button";
import { DialogModule } from "primeng/dialog";
import { InputTextModule } from "primeng/inputtext";
import { SkeletonModule } from "primeng/skeleton";
import { AuthService } from "../core/auth.service";
import { ClientsService } from "../core/clients.service";
import { isDemoMode } from "../core/demo-session";
import { RoleService } from "../core/role.service";
import { TherapyService } from "../core/therapy.service";
import { type SessionInput, type TherapyConnection, type TherapyInvite, type TherapySession, validateSessionInput } from "../core/therapy.types";
import { PageContainerComponent } from "../layout/page-container.component";
import { QueryErrorComponent } from "../ui/query-error.component";

type SessionTab = "upcoming" | "past" | "cancelled";
type Confirmation = { kind: "cancel"; session: TherapySession } | { kind: "revoke"; connection: TherapyConnection } | { kind: "reschedule"; input: SessionInput };

@Component({
  selector: "app-therapy-sessions",
  standalone: true,
  imports: [FormsModule, RouterLink, LucideAngularModule, ButtonModule, DialogModule, InputTextModule, SkeletonModule, PageContainerComponent, QueryErrorComponent],
  template: `
    <app-page-container>
      <header class="animate-fade-in-up">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p class="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-widest text-primary">
              <lucide-icon [img]="icons.CalendarDays" [size]="14" /> A little space to prepare
            </p>
            <h1 class="text-3xl">Therapy sessions</h1>
            <p class="mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground">
              {{ role.isClinician() ? "Know what's on your client's mind before you meet." : "Keep your next session close, and your thoughts ready when you need them." }}
            </p>
          </div>
          <p-button label="Schedule session" ariaLabel="Schedule session" icon="pi pi-plus" styleClass="btn-glow" [disabled]="busy() !== '' || connectionsLoading() || eligibleConnections().length === 0" (onClick)="openSchedule()" />
        </div>
      </header>

      <section class="mt-6 rounded-2xl border border-primary/15 bg-gradient-primary-soft p-4 sm:p-5" aria-label="About pre-session check-ins">
        <div class="flex items-start gap-3">
          <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-card/80 text-primary">
            <lucide-icon [img]="icons.MessageCircle" [size]="20" />
          </span>
          <div class="min-w-0">
            <p class="text-sm font-medium">{{ role.isClinician() ? "A thoughtful start to your next conversation" : "Your session starts with what matters to you" }}</p>
            <p class="mt-1 text-sm leading-relaxed text-muted-foreground">
              SIGGY asks within 24 hours of your session while the app is open. Notes are not monitored for urgent help.
            </p>
            <p class="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <lucide-icon [img]="icons.LockKeyhole" [size]="12" /> {{ role.isClinician() ? "Only notes your client chooses to share appear here." : "Drafts stay private. You choose when to share with your therapist." }}
            </p>
            @if (demo && !role.isClinician() && therapy.upcomingSessions()[0]; as next) {
              <button type="button" (click)="therapy.openNote(next)" class="mt-3 inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md">
                <lucide-icon [img]="icons.Sparkles" [size]="15" /> Try pre-session check-in <lucide-icon [img]="icons.ChevronRight" [size]="15" />
              </button>
            }
          </div>
        </div>
      </section>

      @if (notice()) {
        <p class="mt-4 flex items-center gap-2 rounded-xl bg-success/10 p-3 text-sm" role="status"><lucide-icon [img]="icons.Check" [size]="16" class="text-success" />{{ notice() }}</p>
      }
      @if (pageError()) {
        <p class="mt-4 rounded-xl bg-destructive/10 p-3 text-sm text-destructive" role="alert">{{ pageError() }}</p>
      }

      <section class="mt-7" aria-label="Session list">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="inline-flex max-w-full gap-1 rounded-xl bg-muted/60 p-1" aria-label="Filter sessions">
            @for (item of tabs; track item.value) {
              <button type="button" (click)="tab.set(item.value)" [class]="tabClass(item.value)" [attr.aria-pressed]="tab() === item.value">{{ item.label }} <span class="ml-1 text-xs opacity-60">{{ count(item.value) }}</span></button>
            }
          </div>
          <span class="flex items-center gap-1.5 text-xs text-muted-foreground"><lucide-icon [img]="icons.Clock3" [size]="13" />{{ timezone }}</span>
        </div>

        <div class="mt-4 space-y-4">
          @if (loading()) {
            <p-skeleton height="190px" borderRadius="1rem" />
            <p-skeleton height="150px" borderRadius="1rem" />
          } @else if (loadError()) {
            <app-query-error message="Couldn't load your therapy sessions" (retry)="reload()" />
          } @else if (filteredSessions().length === 0) {
            <div class="empty-state glass-card px-5 py-10">
              <div class="empty-state-icon"><lucide-icon [img]="icons.CalendarDays" [size]="26" /></div>
              <h2 class="text-lg">{{ tab() === "upcoming" ? "Your next conversation belongs here" : tab() === "past" ? "No past sessions yet" : "No cancelled sessions" }}</h2>
              <p class="max-w-sm text-sm leading-relaxed text-muted-foreground">{{ emptyMessage() }}</p>
              @if (tab() === "upcoming") {
                @if (eligibleConnections().length) {
                  <p-button label="Schedule a session" ariaLabel="Schedule a session" [outlined]="true" size="small" (onClick)="openSchedule()" />
                } @else {
                  <p-button [label]="role.isClinician() ? 'Invite a client' : 'Connect with your therapist'" [ariaLabel]="role.isClinician() ? 'Invite a client' : 'Connect with your therapist'" [outlined]="true" size="small" (onClick)="openConnections()" />
                }
              }
            </div>
          } @else {
            @for (session of filteredSessions(); track session.id; let first = $first) {
              <article class="glass-card overflow-hidden" [class.border-primary/30]="tab() === 'upcoming' && first">
                <div class="p-4 sm:p-5">
                  <div class="flex items-start gap-3 sm:gap-4">
                    <div class="flex h-[70px] w-14 shrink-0 flex-col items-center justify-center rounded-xl bg-gradient-primary-soft text-primary">
                      <span class="text-[10px] font-bold uppercase tracking-wider">{{ month(session.starts_at) }}</span>
                      <span class="font-display text-2xl leading-tight">{{ day(session.starts_at) }}</span>
                    </div>
                    <div class="min-w-0 flex-1">
                      <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <h2 class="text-base">{{ participant(session.connection_id) }}</h2>
                        @if (tab() === 'upcoming' && first) { <span class="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">Next session</span> }
                        @if (session.status === 'cancelled') { <span class="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">Cancelled</span> }
                        @if (!connectionActive(session.connection_id)) { <span class="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">Connection ended</span> }
                      </div>
                      <p class="mt-1 text-sm">{{ sessionDate(session.starts_at) }}</p>
                      <p class="mt-1 text-xs text-muted-foreground">{{ sessionTime(session.starts_at) }} · {{ session.duration_minutes }} min · {{ timezone }}</p>
                    </div>
                  </div>

                  @if (therapy.notesBySession().get(session.id); as note) {
                    <div class="mt-4 rounded-xl border border-border/50 bg-background/60 p-3.5">
                      <div class="flex flex-wrap items-center justify-between gap-2">
                        <span class="flex items-center gap-1.5 text-xs font-medium" [class.text-primary]="note.status === 'submitted'">
                          <lucide-icon [img]="note.status === 'draft' ? icons.LockKeyhole : note.reviewed_at ? icons.Check : icons.MessageCircle" [size]="13" />
                          {{ note.status === 'draft' ? 'Private draft' : note.reviewed_at ? 'Reviewed by therapist' : 'Shared with therapist' }}
                        </span>
                        @if (note.submitted_at) { <span class="text-[11px] text-muted-foreground">Shared {{ shortDate(note.submitted_at) }}</span> }
                      </div>
                      <p class="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed">{{ note.body }}</p>
                      @if (role.isClinician() && note.status === 'submitted' && !note.reviewed_at && connectionActive(session.connection_id)) {
                        <div class="mt-3"><p-button label="Mark reviewed" ariaLabel="Mark reviewed" icon="pi pi-check" size="small" [outlined]="true" [loading]="busy() === 'review:' + session.id" [disabled]="busy() !== ''" (onClick)="review(session.id, note.updated_at)" /></div>
                      }
                    </div>
                  } @else {
                    <p class="mt-4 flex items-center gap-2 text-sm text-muted-foreground"><lucide-icon [img]="icons.MessageCircle" [size]="15" />{{ role.isClinician() ? 'No pre-session note shared yet.' : 'A thought, a question, or something you want to make room for.' }}</p>
                  }

                  @if (session.status === 'scheduled' && isFuture(session) && connectionActive(session.connection_id)) {
                    <div class="mt-4 flex flex-wrap items-center gap-2 border-t border-border/50 pt-4">
                      @if (!role.isClinician()) {
                        <p-button [label]="therapy.notesBySession().has(session.id) ? 'Edit note' : 'Write note'" [ariaLabel]="therapy.notesBySession().has(session.id) ? 'Edit note' : 'Write note'" icon="pi pi-pencil" size="small" [outlined]="true" (onClick)="therapy.openNote(session)" />
                      }
                      <p-button label="Reschedule" ariaLabel="Reschedule" [text]="true" size="small" [disabled]="busy() !== ''" (onClick)="openSchedule(session)" />
                      <p-button label="Cancel session" ariaLabel="Cancel session" [text]="true" severity="secondary" size="small" [disabled]="busy() !== ''" (onClick)="askCancel(session)" />
                    </div>
                  }
                </div>
              </article>
            }
          }
        </div>
      </section>

      <section class="mt-7 rounded-2xl border border-border/60 bg-card/50 p-4 sm:p-5" aria-label="Therapy connections">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-center gap-3">
            <span class="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-primary"><lucide-icon [img]="icons.Link2" [size]="18" /></span>
            <div>
              <h2 class="text-sm">{{ role.isClinician() ? 'Your client connections' : 'Your therapist connection' }}</h2>
              <p class="mt-0.5 text-xs text-muted-foreground">{{ eligibleConnections().length ? connectionSummary() : 'Connect securely with a one-time invitation code.' }}</p>
            </div>
          </div>
          <p-button [label]="role.isClinician() ? 'Manage connections' : eligibleConnections().length ? 'Manage connection' : 'Connect therapist'" [ariaLabel]="role.isClinician() ? 'Manage connections' : eligibleConnections().length ? 'Manage connection' : 'Connect therapist'" size="small" [text]="true" (onClick)="openConnections()" />
        </div>
      </section>
    </app-page-container>

    <p-dialog [header]="editingId() ? 'Reschedule session' : 'Schedule a session'" [visible]="scheduleOpen()" (visibleChange)="closeSchedule($event)" [modal]="true" [draggable]="false" [resizable]="false" [closable]="busy() === ''" [closeOnEscape]="busy() === ''" [style]="{ width: '30rem', maxWidth: 'calc(100vw - 2rem)' }">
      <form (ngSubmit)="prepareSave()" class="space-y-4 pt-1">
        <p class="text-sm leading-relaxed text-muted-foreground">Add a session time you have already agreed on with your {{ role.isClinician() ? 'client' : 'therapist' }}. This calendar does not book appointments with an external practice.</p>
        <div>
          <label for="session-connection" class="mb-2 block text-sm font-medium">{{ role.isClinician() ? 'Client' : 'Therapist' }}</label>
          <select id="session-connection" class="w-full rounded-xl border border-border bg-background px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" [ngModel]="formConnection()" (ngModelChange)="formConnection.set($event)" name="connection" [disabled]="busy() !== '' || !!editingId()" required>
            <option value="">Choose {{ role.isClinician() ? 'a client' : 'your therapist' }}</option>
            @for (connection of eligibleConnections(); track connection.id) { <option [value]="connection.id">{{ connectionName(connection) }}</option> }
          </select>
        </div>
        <div>
          <label for="session-start" class="mb-2 block text-sm font-medium">Date and time</label>
          <input pInputText id="session-start" name="start" type="datetime-local" class="w-full" [min]="minDateTime()" [max]="maxDateTime()" [ngModel]="formStart()" (ngModelChange)="formStart.set($event)" [disabled]="busy() !== ''" required />
          <p class="mt-2 text-xs text-muted-foreground">Your local time: {{ timezone }}. Both of you will see this appointment.</p>
        </div>
        <div>
          <label for="session-duration" class="mb-2 block text-sm font-medium">Session length (minutes)</label>
          <input pInputText id="session-duration" name="duration" type="number" min="15" max="180" step="1" class="w-full" [ngModel]="formDuration()" (ngModelChange)="formDuration.set($event)" [disabled]="busy() !== ''" required />
          <p class="mt-2 text-xs text-muted-foreground">15 to 180 minutes</p>
        </div>
        @if (scheduleError()) { <p role="alert" class="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{{ scheduleError() }}</p> }
        <div class="flex flex-wrap justify-end gap-2 pt-2">
          <p-button label="Close" ariaLabel="Close" [text]="true" severity="secondary" [disabled]="busy() !== ''" (onClick)="scheduleOpen.set(false)" />
          <p-button [label]="editingId() ? 'Review changes' : 'Schedule session'" [ariaLabel]="editingId() ? 'Review changes' : 'Schedule session'" type="submit" [loading]="busy() === 'schedule'" [disabled]="!canSaveSession() || busy() !== ''" />
        </div>
      </form>
    </p-dialog>

    <p-dialog [header]="role.isClinician() ? 'Client connections' : 'Connect with your therapist'" [visible]="connectionsOpen()" (visibleChange)="closeConnections($event)" [modal]="true" [draggable]="false" [resizable]="false" [closable]="busy() === ''" [closeOnEscape]="busy() === ''" [style]="{ width: '32rem', maxWidth: 'calc(100vw - 2rem)' }">
      <p class="mb-5 text-sm leading-relaxed text-muted-foreground">{{ role.isClinician() ? 'Create an invitation for a client, then give them the code through your usual trusted channel. Each code can be accepted once and expires in 7 days.' : 'Enter the invitation code your therapist gave you. You will see their name before you choose to connect.' }}</p>
      @if (role.isClinician()) {
        @if (clients.clientsQuery.isPending()) {
          <p-skeleton height="100px" />
        } @else if (clients.clientsQuery.isError()) {
          <app-query-error message="Couldn't load your clients" (retry)="clients.clientsQuery.refetch()" />
        } @else if (!(clients.clientsQuery.data() ?? []).length) {
          <p class="text-sm text-muted-foreground">Add a client to your caseload before creating an invitation.</p>
          <a routerLink="/clients" (click)="connectionsOpen.set(false)" class="mt-3 inline-block font-medium text-primary hover:underline">Go to clients</a>
        } @else {
          <form (ngSubmit)="createInvite()" class="space-y-4">
            <div>
              <label class="mb-2 block text-sm font-medium" for="invite-client">Client</label>
              <select id="invite-client" name="client" class="w-full rounded-xl border border-border bg-background px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" [ngModel]="inviteClient()" (ngModelChange)="setInviteClient($event)" [disabled]="busy() !== ''" required>
                <option value="">Choose a client</option>
                @for (client of clients.clientsQuery.data() ?? []; track client.id) { <option [value]="client.id">{{ client.name }}</option> }
              </select>
            </div>
            <div>
              <label class="mb-2 block text-sm font-medium" for="therapist-name">Your name as your client knows it</label>
              <input pInputText id="therapist-name" name="therapist-name" class="w-full" maxlength="120" placeholder="e.g. Dr. Morgan Lee" [ngModel]="therapistName()" (ngModelChange)="setTherapistName($event)" [disabled]="busy() !== ''" required />
            </div>
            <p-button label="Create invitation" ariaLabel="Create invitation" type="submit" [disabled]="!inviteClient() || !therapistName().trim() || busy() !== ''" [loading]="busy() === 'invite'" />
          </form>
          @if (createdInvite(); as invitation) {
            <div class="mt-4 rounded-xl border border-primary/20 bg-gradient-primary-soft p-4" role="status">
              <p class="text-sm font-medium">Invitation for {{ invitationClientName(invitation) }}</p>
              <label for="invitation-code" class="mt-2 block text-xs text-muted-foreground">One-time code · expires {{ shortDate(invitation.expires_at) }}</label>
              <input pInputText id="invitation-code" class="mt-2 w-full font-mono text-xs" [value]="invitation.token" readonly (focus)="selectCode($event)" />
              <p-button [label]="copied() ? 'Copied' : 'Copy code'" [ariaLabel]="copied() ? 'Copied' : 'Copy code'" [icon]="copied() ? 'pi pi-check' : 'pi pi-copy'" size="small" [text]="true" styleClass="mt-2" [disabled]="busy() !== ''" (onClick)="copyInvite()" />
            </div>
          }
        }
      } @else {
        <form (ngSubmit)="previewInvite()" class="space-y-3">
          <label for="connection-code" class="block text-sm font-medium">Invitation code</label>
          <input pInputText id="connection-code" name="code" class="w-full font-mono text-sm" placeholder="Paste your invitation code" autocomplete="off" spellcheck="false" [ngModel]="inviteCode()" (ngModelChange)="setInviteCode($event)" [disabled]="busy() !== ''" required />
          <p-button label="Check invitation" ariaLabel="Check invitation" type="submit" [outlined]="true" [disabled]="!inviteCode().trim() || busy() !== ''" [loading]="busy() === 'preview'" />
        </form>
        @if (invitePreview(); as preview) {
          <div class="mt-4 rounded-xl border border-primary/20 bg-gradient-primary-soft p-4">
            <p class="text-xs font-medium uppercase tracking-wider text-primary">Invitation from</p>
            <h3 class="mt-1 text-lg">{{ preview.therapist_name }}</h3>
            <p class="mt-2 text-sm leading-relaxed text-muted-foreground">Connect only if you recognize your therapist. This lets you both schedule sessions and lets them read the pre-session notes you choose to share.</p>
            <p class="mt-2 text-xs text-muted-foreground">Expires {{ shortDate(preview.expires_at) }}</p>
            <p-button label="Accept and connect" ariaLabel="Accept and connect" styleClass="mt-4" [disabled]="busy() !== ''" [loading]="busy() === 'accept'" (onClick)="acceptInvite()" />
          </div>
        }
      }
      @if (connectionError()) { <p role="alert" class="mt-4 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{{ connectionError() }}</p> }
      @if (connectionNotice()) { <p role="status" class="mt-4 rounded-xl bg-success/10 p-3 text-sm">{{ connectionNotice() }}</p> }
      <div class="mt-6 border-t border-border/60 pt-4">
        <h3 class="mb-3 text-sm">Your connections</h3>
        @if (connectionsLoading()) { <p-skeleton height="60px" /> }
        @else if (therapy.connectionsQuery.isError()) { <app-query-error message="Couldn't load connections" (retry)="therapy.connectionsQuery.refetch()" /> }
        @else if (!(therapy.connectionsQuery.data() ?? []).length) { <p class="text-sm text-muted-foreground">No connections yet.</p> }
        @else {
          <div class="space-y-3">
            @for (connection of therapy.connectionsQuery.data() ?? []; track connection.id) {
              <div class="flex items-center justify-between gap-3 rounded-xl bg-muted/40 p-3">
                <div class="min-w-0"><p class="break-words text-sm font-medium">{{ connectionName(connection) }}</p><p class="mt-1 text-xs text-muted-foreground">{{ connection.revoked_at ? 'Connection ended' : connection.user_id ? 'Connected' : 'Awaiting acceptance' }}</p></div>
                @if (!connection.revoked_at) { <p-button label="Disconnect" ariaLabel="Disconnect" size="small" [text]="true" severity="secondary" [disabled]="busy() !== ''" (onClick)="askRevoke(connection)" /> }
              </div>
            }
          </div>
        }
      </div>
    </p-dialog>

    <p-dialog [header]="confirmationTitle()" [visible]="confirmation() !== null" (visibleChange)="closeConfirmation($event)" [modal]="true" [draggable]="false" [resizable]="false" [closable]="busy() === ''" [closeOnEscape]="busy() === ''" [style]="{ width: '27rem', maxWidth: 'calc(100vw - 2rem)' }">
      <p class="text-sm leading-relaxed text-muted-foreground">{{ confirmationMessage() }}</p>
      @if (confirmationError()) { <p class="mt-3 rounded-xl bg-destructive/10 p-3 text-sm text-destructive" role="alert">{{ confirmationError() }}</p> }
      <div class="mt-6 flex flex-wrap justify-end gap-2">
        <p-button label="Go back" ariaLabel="Go back" [text]="true" severity="secondary" [disabled]="busy() !== ''" (onClick)="confirmation.set(null)" />
        <p-button [label]="confirmation()?.kind === 'reschedule' ? 'Confirm reschedule' : confirmation()?.kind === 'revoke' ? 'Disconnect' : 'Cancel session'" [ariaLabel]="confirmation()?.kind === 'reschedule' ? 'Confirm reschedule' : confirmation()?.kind === 'revoke' ? 'Disconnect' : 'Cancel session'" [severity]="confirmation()?.kind === 'reschedule' ? 'primary' : 'danger'" [loading]="busy() === 'confirm'" [disabled]="busy() !== ''" (onClick)="confirmAction()" />
      </div>
    </p-dialog>
  `,
})
export class TherapySessionsComponent {
  readonly therapy = inject(TherapyService);
  readonly role = inject(RoleService);
  readonly clients = inject(ClientsService);
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthService);
  private stateContext: string | null = null;
  private operationGeneration = 0;
  readonly icons = { CalendarDays, Check, ChevronRight, Clock3, Link2, LockKeyhole, MessageCircle, Plus, Sparkles, Users };
  readonly demo = isDemoMode();
  readonly timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  readonly tabs: { value: SessionTab; label: string }[] = [{ value: "upcoming", label: "Upcoming" }, { value: "past", label: "Past" }, { value: "cancelled", label: "Cancelled" }];
  readonly tab = signal<SessionTab>("upcoming");
  readonly busy = signal("");
  readonly notice = signal("");
  readonly pageError = signal("");
  readonly scheduleOpen = signal(false);
  readonly scheduleError = signal("");
  readonly editingId = signal<string | null>(null);
  readonly formConnection = signal("");
  readonly formStart = signal("");
  readonly formDuration = signal<number>(50);
  readonly connectionsOpen = signal(false);
  readonly connectionError = signal("");
  readonly connectionNotice = signal("");
  readonly inviteClient = signal("");
  readonly therapistName = signal("");
  readonly createdInvite = signal<TherapyInvite | null>(null);
  readonly copied = signal(false);
  readonly inviteCode = signal("");
  readonly invitePreview = signal<{ therapist_name: string; expires_at: string } | null>(null);
  private previewedCode = "";
  readonly confirmation = signal<Confirmation | null>(null);
  readonly confirmationError = signal("");
  readonly connectionsLoading = computed(() => this.therapy.connectionsQuery.isPending());
  readonly eligibleConnections = computed(() => this.therapy.activeConnections().filter((connection) => !!connection.user_id));
  readonly loading = computed(() => this.therapy.sessionsQuery.isPending() || this.therapy.notesQuery.isPending() || this.connectionsLoading());
  readonly loadError = computed(() => this.therapy.sessionsQuery.isError() || this.therapy.notesQuery.isError() || this.therapy.connectionsQuery.isError());
  readonly sessionGroups = computed(() => {
    const groups: Record<SessionTab, TherapySession[]> = { upcoming: [], past: [], cancelled: [] };
    for (const session of this.therapy.sessionsQuery.data() ?? []) {
      groups[session.status === "cancelled" ? "cancelled" : this.isFuture(session) ? "upcoming" : "past"].push(session);
    }
    groups.upcoming.sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
    groups.past.sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at));
    groups.cancelled.sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at));
    return groups;
  });
  readonly filteredSessions = computed(() => this.sessionGroups()[this.tab()]);
  readonly minDateTime = computed(() => format(new Date(this.therapy.now() + 60000), "yyyy-MM-dd'T'HH:mm"));
  readonly maxDateTime = computed(() => format(new Date(this.therapy.now() + 365 * 86400000), "yyyy-MM-dd'T'HH:mm"));
  readonly canSaveSession = computed(() => !!this.formConnection() && !!this.formStart() && Number.isInteger(this.formDuration()) && this.formDuration() >= 15 && this.formDuration() <= 180);
  readonly confirmationTitle = computed(() => this.confirmation()?.kind === "reschedule" ? "Confirm your new time" : this.confirmation()?.kind === "revoke" ? "End this connection?" : "Cancel this session?");
  readonly confirmationMessage = computed(() => {
    const value = this.confirmation();
    if (!value) return "";
    if (value.kind === "reschedule") return `Move this session to ${this.sessionDate(value.input.starts_at)} at ${this.sessionTime(value.input.starts_at)} (${this.timezone}), for ${value.input.duration_minutes} minutes? Both participants will see the updated appointment.`;
    if (value.kind === "revoke") return `Disconnect from ${this.connectionName(value.connection)}? Future sessions will be cancelled and this connection will no longer allow scheduling or sharing notes.`;
    return `Cancel your session with ${this.participant(value.session.connection_id)} on ${this.sessionDate(value.session.starts_at)} at ${this.sessionTime(value.session.starts_at)}? It will be marked cancelled for both of you.`;
  });

  constructor() {
    effect(() => {
      const context = `${this.auth.user()?.id ?? ""}:${this.role.role() ?? ""}`;
      untracked(() => {
        if (this.stateContext !== null && this.stateContext !== context) this.resetLocalState();
        this.stateContext = context;
      });
    });
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const view = params.get("view");
      if (this.demo && (view === "clinician" || view === "client")) this.role.setRole(view);
    });
  }

  private operationContext(): string { return `${this.auth.user()?.id ?? ""}:${this.role.role() ?? ""}:${this.operationGeneration}`; }
  private resetLocalState(): void {
    this.operationGeneration += 1;
    this.busy.set(""); this.notice.set(""); this.pageError.set(""); this.tab.set("upcoming");
    this.scheduleOpen.set(false); this.scheduleError.set(""); this.editingId.set(null);
    this.formConnection.set(""); this.formStart.set(""); this.formDuration.set(50);
    this.connectionsOpen.set(false); this.connectionError.set(""); this.connectionNotice.set("");
    this.inviteClient.set(""); this.therapistName.set(""); this.createdInvite.set(null); this.copied.set(false);
    this.inviteCode.set(""); this.invitePreview.set(null); this.previewedCode = "";
    this.confirmation.set(null); this.confirmationError.set("");
  }
  count(tab: SessionTab): number { return this.sessionGroups()[tab].length; }
  isFuture(session: TherapySession): boolean { return Date.parse(session.starts_at) > this.therapy.now(); }
  connectionActive(id: string): boolean { return this.eligibleConnections().some((connection) => connection.id === id); }
  connectionName(connection: TherapyConnection): string { return this.role.isClinician() ? this.clients.clientsById().get(connection.client_id)?.name ?? "Connected client" : connection.therapist_name; }
  participant(id: string): string { const connection = this.therapy.connectionsQuery.data()?.find((item) => item.id === id); return connection ? this.connectionName(connection) : this.role.isClinician() ? "Client session" : "Therapy session"; }
  connectionSummary(): string { const list = this.eligibleConnections(); return list.length === 1 ? `Connected with ${this.connectionName(list[0])}` : `${list.length} active connections`; }
  month(iso: string): string { return format(new Date(iso), "MMM"); }
  day(iso: string): string { return format(new Date(iso), "d"); }
  sessionDate(iso: string): string { return format(new Date(iso), "EEEE, MMMM d, yyyy"); }
  sessionTime(iso: string): string { return format(new Date(iso), "h:mm a"); }
  shortDate(iso: string): string { return format(new Date(iso), "MMM d, yyyy"); }
  tabClass(tab: SessionTab): string { return `min-h-10 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${this.tab() === tab ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"}`; }
  emptyMessage(): string {
    if (this.tab() === "past") return "Once a session's date has passed, you can revisit it and its pre-session note here.";
    if (this.tab() === "cancelled") return "Sessions you cancel will stay here so you can keep track of changes.";
    return this.eligibleConnections().length ? "Add your next appointment. You can jot down a private thought whenever you feel ready." : this.role.isClinician() ? "Invite a client to connect, then add the appointment you have agreed on." : "Start by accepting an invitation from your therapist, then add your next appointment.";
  }
  reload(): void { void this.therapy.sessionsQuery.refetch(); void this.therapy.notesQuery.refetch(); void this.therapy.connectionsQuery.refetch(); }
  openSchedule(session?: TherapySession): void {
    if (this.busy()) return;
    this.scheduleError.set("");
    if (session) {
      this.editingId.set(session.id); this.formConnection.set(session.connection_id); this.formStart.set(format(new Date(session.starts_at), "yyyy-MM-dd'T'HH:mm")); this.formDuration.set(session.duration_minutes);
    } else if (this.editingId() || !this.formStart()) {
      this.editingId.set(null); this.formConnection.set(this.eligibleConnections()[0]?.id ?? "");
      const date = new Date(this.therapy.now() + 86400000); date.setMinutes(0, 0, 0);
      this.formStart.set(format(date, "yyyy-MM-dd'T'HH:mm")); this.formDuration.set(50);
    }
    this.scheduleOpen.set(true);
  }
  closeSchedule(visible: boolean): void { if (!this.busy()) this.scheduleOpen.set(visible); }
  closeConnections(visible: boolean): void { if (!this.busy()) this.connectionsOpen.set(visible); }
  closeConfirmation(visible: boolean): void { if (!visible && !this.busy()) this.confirmation.set(null); }
  openConnections(): void { this.connectionError.set(""); this.connectionNotice.set(""); this.connectionsOpen.set(true); }
  async prepareSave(): Promise<void> {
    if (this.busy()) return;
    const operation = this.operationContext();
    this.scheduleError.set("");
    try {
      const date = new Date(this.formStart());
      const input = validateSessionInput({ connection_id: this.formConnection(), starts_at: Number.isFinite(date.getTime()) ? date.toISOString() : "", duration_minutes: this.formDuration(), ...(this.editingId() ? { id: this.editingId()! } : {}) }, this.therapy.now());
      if (!this.connectionActive(input.connection_id)) throw new Error("Choose an active connection before scheduling.");
      if (input.id) { this.confirmationError.set(""); this.confirmation.set({ kind: "reschedule", input }); return; }
      this.busy.set("schedule");
      await this.therapy.saveSession(input);
      if (operation !== this.operationContext()) return;
      this.scheduleOpen.set(false); this.formStart.set(""); this.notice.set("Your session is scheduled."); this.tab.set("upcoming");
    } catch (error) { if (operation === this.operationContext()) this.scheduleError.set(this.errorMessage(error)); }
    finally { if (operation === this.operationContext()) this.busy.set(""); }
  }
  askCancel(session: TherapySession): void { this.confirmationError.set(""); this.confirmation.set({ kind: "cancel", session }); }
  askRevoke(connection: TherapyConnection): void { this.confirmationError.set(""); this.confirmation.set({ kind: "revoke", connection }); }
  async confirmAction(): Promise<void> {
    const action = this.confirmation(); if (!action || this.busy()) return;
    const operation = this.operationContext();
    this.busy.set("confirm"); this.confirmationError.set("");
    try {
      if (action.kind === "reschedule") await this.therapy.saveSession(action.input);
      else if (action.kind === "cancel") await this.therapy.cancelSession(action.session.id);
      else await this.therapy.revokeConnection(action.connection.id);
      if (operation !== this.operationContext()) return;
      if (action.kind === "reschedule") { this.scheduleOpen.set(false); this.editingId.set(null); this.formStart.set(""); this.notice.set("Your session has been rescheduled."); }
      else if (action.kind === "cancel") this.notice.set("The session has been cancelled.");
      else { this.connectionNotice.set("The connection has ended."); this.notice.set("The connection has ended."); }
      this.confirmation.set(null);
    } catch (error) { if (operation === this.operationContext()) this.confirmationError.set(this.errorMessage(error)); }
    finally { if (operation === this.operationContext()) this.busy.set(""); }
  }
  async review(id: string, expectedUpdatedAt: string): Promise<void> {
    if (this.busy()) return;
    const operation = this.operationContext();
    this.busy.set(`review:${id}`); this.pageError.set("");
    try { await this.therapy.markReviewed(id, expectedUpdatedAt); if (operation === this.operationContext()) this.notice.set("The note is marked as reviewed."); }
    catch (error) { if (operation === this.operationContext()) this.pageError.set(this.errorMessage(error)); }
    finally { if (operation === this.operationContext()) this.busy.set(""); }
  }
  setInviteClient(value: string): void { this.inviteClient.set(value); this.clearCreatedInvite(); }
  setTherapistName(value: string): void { this.therapistName.set(value); this.clearCreatedInvite(); }
  private clearCreatedInvite(): void { this.createdInvite.set(null); this.copied.set(false); }
  invitationClientName(invite: TherapyInvite): string { return this.clients.clientsById().get(invite.connection.client_id)?.name ?? "your selected client"; }
  async createInvite(): Promise<void> {
    if (this.busy() || !this.inviteClient() || !this.therapistName().trim()) return;
    const operation = this.operationContext();
    this.busy.set("invite"); this.connectionError.set(""); this.connectionNotice.set(""); this.clearCreatedInvite();
    try {
      const invitation = await this.therapy.createInvite(this.inviteClient(), this.therapistName().trim());
      if (operation === this.operationContext()) this.createdInvite.set(invitation);
    }
    catch (error) { if (operation === this.operationContext()) this.connectionError.set(this.errorMessage(error)); }
    finally { if (operation === this.operationContext()) this.busy.set(""); }
  }
  setInviteCode(value: string): void { this.inviteCode.set(value); this.invitePreview.set(null); this.previewedCode = ""; }
  async previewInvite(): Promise<void> {
    if (this.busy() || !this.inviteCode().trim()) return;
    const operation = this.operationContext();
    this.busy.set("preview"); this.connectionError.set(""); this.connectionNotice.set(""); this.invitePreview.set(null);
    const code = this.inviteCode().trim();
    try {
      const preview = await this.therapy.previewInvite(code);
      if (operation !== this.operationContext()) return;
      this.previewedCode = code; this.invitePreview.set(preview);
    }
    catch (error) { if (operation === this.operationContext()) this.connectionError.set(this.errorMessage(error)); }
    finally { if (operation === this.operationContext()) this.busy.set(""); }
  }
  async acceptInvite(): Promise<void> {
    if (this.busy() || !this.invitePreview() || this.previewedCode !== this.inviteCode().trim()) return;
    const operation = this.operationContext();
    this.busy.set("accept"); this.connectionError.set("");
    try {
      const connection = await this.therapy.acceptInvite(this.previewedCode);
      if (operation !== this.operationContext()) return;
      this.connectionNotice.set(`You are now connected with ${connection.therapist_name}.`); this.inviteCode.set(""); this.invitePreview.set(null); this.previewedCode = "";
    }
    catch (error) { if (operation === this.operationContext()) this.connectionError.set(this.errorMessage(error)); }
    finally { if (operation === this.operationContext()) this.busy.set(""); }
  }
  selectCode(event: Event): void { (event.target as HTMLInputElement).select(); }
  async copyInvite(): Promise<void> {
    const invite = this.createdInvite(); if (!invite || this.busy()) return;
    const operation = this.operationContext();
    try { await navigator.clipboard.writeText(invite.token); if (operation === this.operationContext() && this.createdInvite()?.token === invite.token) this.copied.set(true); }
    catch { if (operation === this.operationContext()) this.connectionError.set("Select the invitation code above and copy it to share with your client."); }
  }
  private errorMessage(error: unknown): string { return error instanceof Error ? error.message : "We couldn't save that change. Please try again."; }
}
