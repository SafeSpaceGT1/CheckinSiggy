import { QueryErrorComponent } from "../ui/query-error.component";
import { Component, computed, effect, inject, signal } from "@angular/core";
import { ActivatedRoute } from "@angular/router";
import { toSignal } from "@angular/core/rxjs-interop";
import { map } from "rxjs";
import { FormsModule } from "@angular/forms";
import { format } from "date-fns";
import { ClipboardList, LucideAngularModule } from "lucide-angular";
import { MessageService } from "primeng/api";
import { ButtonModule } from "primeng/button";
import { ConfirmPopupModule } from "primeng/confirmpopup";
import { InputTextModule } from "primeng/inputtext";
import { SelectModule } from "primeng/select";
import { SkeletonModule } from "primeng/skeleton";
import { TextareaModule } from "primeng/textarea";
import {
  ClientsService,
  NOTE_FORMATS,
  type NoteFormat,
} from "../core/clients.service";
import { FeedbackService } from "../core/feedback.service";
import { PageContainerComponent } from "../layout/page-container.component";
import { ClinicianGateComponent } from "../ui/clinician-gate.component";
import { SoapNoteCardComponent } from "../ui/soap-note-card.component";

const FORMATS: NoteFormat[] = ["SOAP", "DAP", "BIRP"];

@Component({
  selector: "app-soap-notes",
  standalone: true,
  imports: [QueryErrorComponent,
    FormsModule,
    LucideAngularModule,
    ButtonModule,
    ConfirmPopupModule,
    InputTextModule,
    SelectModule,
    SkeletonModule,
    TextareaModule,
    PageContainerComponent,
    ClinicianGateComponent,
    SoapNoteCardComponent,
  ],
  template: `
    <app-page-container maxWidth="md">
      <header class="animate-fade-in-up">
        <h1 class="text-3xl">Session notes</h1>
        <p class="mt-2 text-sm text-muted-foreground">
          SOAP, DAP, or BIRP — pick the shape, the sections follow.
        </p>
      </header>

      <app-clinician-gate>
        <section class="mt-6 animate-fade-in-up" style="animation-delay: 60ms" aria-label="New note">
          <div class="glass-card p-5">
            <div class="grid gap-3 sm:grid-cols-2">
              <div>
                <label class="text-sm font-medium" for="note-client">Client</label>
                <p-select
                  inputId="note-client"
                  [options]="clientOptions()"
                  optionLabel="name"
                  optionValue="id"
                  placeholder="Choose a client"
                  styleClass="w-full mt-2"
                  class="mt-2 block w-full"
                  [filter]="clientOptions().length > 6"
                  appendTo="body"
                  [ngModel]="selectedClientId()" [disabled]="clients.addNoteMutation.isPending()"
                  (ngModelChange)="selectedClientId.set($event)"
                />
              </div>
              <div>
                <label class="text-sm font-medium" for="note-date">Session date</label>
                <input
                  pInputText
                  id="note-date"
                  type="date"
                  class="mt-2 w-full"
                  [ngModel]="sessionDate()" [disabled]="clients.addNoteMutation.isPending()"
                  (ngModelChange)="sessionDate.set($event)"
                />
              </div>
            </div>

            <p class="mt-4 text-sm font-medium">Format</p>
            <div class="mt-2 flex gap-2">
              @for (fmt of formats; track fmt) {
                <button type="button" (click)="setFormat(fmt)" [disabled]="clients.addNoteMutation.isPending()" [class]="formatChip(fmt)">
                  {{ fmt }}
                </button>
              }
            </div>

            <div class="mt-4 space-y-4">
              @for (section of sections(); track section.key) {
                <div>
                  <label class="text-sm font-medium" [attr.for]="'section-' + section.key">
                    {{ section.label }}
                  </label>
                  <p class="text-xs text-muted-foreground">{{ section.hint }}</p>
                  <textarea
                    pTextarea
                    [id]="'section-' + section.key"
                    rows="3"
                    class="mt-2 w-full"
                    [ngModel]="draft(section.key)" [disabled]="clients.addNoteMutation.isPending()"
                    (ngModelChange)="setDraft(section.key, $event)"
                  ></textarea>
                </div>
              }
            </div>

            <p-button
              label="Save note"
              styleClass="w-full btn-glow mt-5"
              class="mt-5 block w-full"
              [disabled]="!canSave()"
              [loading]="clients.addNoteMutation.isPending()"
              (onClick)="save()"
            />
          </div>
        </section>

        <section class="mt-8 animate-fade-in-up" style="animation-delay: 120ms" aria-label="Notes">
          <div class="flex items-center justify-between gap-3">
            <h2 class="text-xl">Recent notes</h2>
            <p-select
              [options]="filterOptions()"
              optionLabel="name"
              optionValue="id"
              placeholder="All clients"
              [showClear]="true"
              styleClass="min-w-[160px]"
              appendTo="body"
              [ngModel]="filterClientId()"
              (ngModelChange)="filterClientId.set($event)"
              ariaLabel="Filter notes by client"
            />
          </div>

          <div class="mt-3 space-y-3">
            @if (clients.notesQuery.isPending()) {
              @for (i of [0, 1]; track i) {
                <p-skeleton height="96px" borderRadius="1rem" />
              }
            } @else if (clients.notesQuery.isError()) {
            <app-query-error message="Couldn't load your session notes" (retry)="clients.notesQuery.refetch()" />
          } @else if (filteredNotes().length === 0) {
              <div class="empty-state">
                <div class="empty-state-icon">
                  <lucide-icon [img]="ClipboardList" [size]="24" />
                </div>
                <p class="font-medium">No notes yet</p>
                <p class="max-w-xs text-sm text-muted-foreground">
                  Saved session notes will collect here, newest first.
                </p>
              </div>
            } @else {
              @for (note of filteredNotes(); track note.id) {
                <app-soap-note-card [note]="note" [clientName]="clientName(note.client_id)" />
              }
            }
          </div>
        </section>
      </app-clinician-gate>
    </app-page-container>

    <p-confirmpopup />
  `,
})
export class SoapNotesComponent {
  readonly ClipboardList = ClipboardList;
  readonly formats = FORMATS;

  readonly clients = inject(ClientsService);
  private readonly route = inject(ActivatedRoute);
  private readonly feedback = inject(FeedbackService);
  private readonly messages = inject(MessageService);

  readonly selectedClientId = signal<string | null>(null);
  readonly sessionDate = signal(format(new Date(), "yyyy-MM-dd"));
  readonly noteFormat = signal<NoteFormat>("SOAP");
  private readonly drafts = signal<Record<string, string>>({});
  readonly filterClientId = signal<string | null>(null);

  private readonly clientParam = toSignal(
    this.route.queryParamMap.pipe(map((params) => params.get("client"))),
    { initialValue: this.route.snapshot.queryParamMap.get("client") }
  );

  constructor() {
    // Arriving from a client profile preselects that client — once.
    effect(() => {
      const param = this.clientParam();
      if (param && !this.selectedClientId() && this.clients.clientsById().has(param)) {
        this.selectedClientId.set(param);
      }
    });
  }

  readonly clientOptions = computed(() =>
    (this.clients.clientsQuery.data() ?? []).map((client) => ({
      id: client.id,
      name: client.name,
    }))
  );

  readonly filterOptions = this.clientOptions;

  readonly sections = computed(() => NOTE_FORMATS[this.noteFormat()]);

  readonly canSave = computed(() => {
    if (!this.selectedClientId() || this.clients.addNoteMutation.isPending()) return false;
    const drafts = this.drafts();
    return this.sections().some((section) => (drafts[section.key] ?? "").trim().length > 0);
  });

  readonly filteredNotes = computed(() => {
    const notes = this.clients.notesQuery.data() ?? [];
    const filter = this.filterClientId();
    return filter ? notes.filter((note) => note.client_id === filter) : notes;
  });

  clientName(id: string): string | null {
    return this.clients.clientsById().get(id)?.name ?? null;
  }

  draft(key: string): string {
    return this.drafts()[key] ?? "";
  }

  setDraft(key: string, value: string) {
    this.drafts.update((drafts) => ({ ...drafts, [key]: value }));
  }

  setFormat(fmt: NoteFormat) {
    this.feedback.trigger("tap");
    this.noteFormat.set(fmt);
  }

  /** Full class strings — Tailwind variant names can't live in [class.x] bindings. */
  formatChip(fmt: NoteFormat): string {
    const base =
      "min-h-[44px] flex-1 rounded-full border px-4 py-2 text-sm font-semibold transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
    return this.noteFormat() === fmt
      ? `${base} border-transparent bg-gradient-primary text-primary-foreground shadow-glow`
      : `${base} border-border/60 bg-card/70 hover:border-primary/40`;
  }

  save() {
    if (!this.canSave()) return;
    const clientId = this.selectedClientId();
    if (!clientId) return;
    const drafts = this.drafts();
    const content: Record<string, string> = {};
    for (const section of this.sections()) {
      const text = (drafts[section.key] ?? "").trim();
      if (text) content[section.key] = text;
    }
    this.clients.addNoteMutation.mutate(
      {
        client_id: clientId,
        format: this.noteFormat(),
        session_date: this.sessionDate() || format(new Date(), "yyyy-MM-dd"),
        content,
      },
      {
        onSuccess: () => {
          this.feedback.trigger("success");
          this.messages.add({ severity: "success", summary: "Note saved" });
          this.drafts.set({});
        },
        onError: (error) => {
          this.feedback.trigger("error");
          this.messages.add({
            severity: "error",
            summary: "Something went wrong",
            detail: error.message,
          });
        },
      }
    );
  }
}
