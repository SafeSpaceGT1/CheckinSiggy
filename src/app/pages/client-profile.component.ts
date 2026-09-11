import { QueryErrorComponent } from "../ui/query-error.component";
import { Component, computed, inject } from "@angular/core";
import { ActivatedRoute, Router } from "@angular/router";
import { toSignal } from "@angular/core/rxjs-interop";
import { map } from "rxjs";
import { format } from "date-fns";
import { LucideAngularModule, Mail, Phone, Plus, Trash2 } from "lucide-angular";
import { ConfirmationService, MessageService } from "primeng/api";
import { ButtonModule } from "primeng/button";
import { ConfirmPopupModule } from "primeng/confirmpopup";
import { SkeletonModule } from "primeng/skeleton";
import { ClientsService } from "../core/clients.service";
import { telHref } from "../core/crisis-plan.service";
import { FeedbackService } from "../core/feedback.service";
import { PageContainerComponent } from "../layout/page-container.component";
import { ClinicianGateComponent } from "../ui/clinician-gate.component";
import { SoapNoteCardComponent } from "../ui/soap-note-card.component";

@Component({
  selector: "app-client-profile",
  standalone: true,
  imports: [QueryErrorComponent,
    LucideAngularModule,
    ButtonModule,
    ConfirmPopupModule,
    SkeletonModule,
    PageContainerComponent,
    ClinicianGateComponent,
    SoapNoteCardComponent,
  ],
  template: `
    <app-page-container maxWidth="md">
      <app-clinician-gate>
        <p-button
          label="All clients"
          icon="pi pi-arrow-left"
          [text]="true"
          size="small"
          (onClick)="back()"
        />

        @if (clients.clientsQuery.isPending()) {
          <div class="mt-4 space-y-3">
            <p-skeleton height="120px" borderRadius="1rem" />
            <p-skeleton height="88px" borderRadius="1rem" />
          </div>
        } @else if (clients.clientsQuery.isError()) {
            <app-query-error message="Couldn't load this client" (retry)="clients.clientsQuery.refetch()" />
          } @else if (!client()) {
          <div class="empty-state mt-8 animate-fade-in-up">
            <span class="text-3xl">🔍</span>
            <p class="font-medium">Client not found</p>
            <p class="max-w-xs text-sm text-muted-foreground">
              They may have been removed. Head back to your client list.
            </p>
            <p-button label="Back to clients" styleClass="mt-2" [outlined]="true" (onClick)="back()" />
          </div>
        } @else {
          <header class="glass-card-elevated mt-4 animate-fade-in-up p-5">
            <div class="flex items-center gap-4">
              <span
                class="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gradient-primary font-display text-xl text-primary-foreground shadow-glow"
              >
                {{ initials() }}
              </span>
              <div class="min-w-0 flex-1">
                <h1 class="truncate text-2xl">{{ client()!.name }}</h1>
                <p class="text-xs text-muted-foreground">Client since {{ sinceLabel() }}</p>
              </div>
            </div>
            <div class="mt-4 flex flex-wrap gap-2">
              @if (client()!.phone) {
                <a [href]="tel(client()!.phone!)" [class]="contactChip">
                  <lucide-icon [img]="icons.Phone" [size]="14" />
                  {{ client()!.phone }}
                </a>
              }
              @if (client()!.email) {
                <a [href]="'mailto:' + client()!.email" [class]="contactChip">
                  <lucide-icon [img]="icons.Mail" [size]="14" />
                  {{ client()!.email }}
                </a>
              }
            </div>
            <div class="mt-4 flex flex-wrap gap-2">
              <p-button
                label="New session note"
                icon="pi pi-plus"
                size="small"
                styleClass="btn-glow"
                (onClick)="newNote()"
              />
              <p-button
                label="Delete client"
                icon="pi pi-trash"
                size="small"
                severity="danger"
                [outlined]="true"
                (onClick)="confirmDelete($event)"
              />
            </div>
          </header>

          <section class="mt-6 animate-fade-in-up" style="animation-delay: 60ms" aria-label="Session notes">
            <h2 class="text-xl">Session notes</h2>
            <div class="mt-3 space-y-3">
              @if (clients.notesQuery.isPending()) {
                <p-skeleton height="96px" borderRadius="1rem" />
              } @else if (clients.notesQuery.isError()) {
            <app-query-error message="Couldn't load the session notes" (retry)="clients.notesQuery.refetch()" />
          } @else if (notes().length === 0) {
                <div class="empty-state">
                  <span class="text-3xl">📋</span>
                  <p class="font-medium">No notes yet</p>
                  <p class="max-w-xs text-sm text-muted-foreground">
                    Session notes for {{ client()!.name.split(" ")[0] }} will collect here.
                  </p>
                  <p-button
                    label="Write the first one"
                    styleClass="btn-glow mt-2"
                    (onClick)="newNote()"
                  />
                </div>
              } @else {
                @for (note of notes(); track note.id) {
                  <app-soap-note-card [note]="note" />
                }
              }
            </div>
          </section>
        }
      </app-clinician-gate>
    </app-page-container>

    <p-confirmpopup />
  `,
})
export class ClientProfileComponent {
  readonly icons = { Phone, Mail, Plus, Trash2 };

  readonly clients = inject(ClientsService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly feedback = inject(FeedbackService);
  private readonly messages = inject(MessageService);
  private readonly confirmation = inject(ConfirmationService);

  readonly contactChip =
    "flex min-h-[40px] items-center gap-1.5 rounded-full bg-muted/70 px-3.5 py-2 text-xs font-medium transition-colors hover:bg-accent";

  private readonly clientId = toSignal(
    this.route.paramMap.pipe(map((params) => params.get("id") ?? "")),
    { initialValue: this.route.snapshot.paramMap.get("id") ?? "" }
  );

  readonly client = computed(() => this.clients.clientsById().get(this.clientId()) ?? null);

  readonly notes = computed(() =>
    (this.clients.notesQuery.data() ?? []).filter((note) => note.client_id === this.clientId())
  );

  readonly initials = computed(() =>
    (this.client()?.name ?? "?")
      .split(/\s+/)
      .map((part) => part[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase()
  );

  readonly sinceLabel = computed(() => {
    const client = this.client();
    return client ? format(new Date(client.created_at), "MMMM yyyy") : "";
  });

  tel(phone: string): string {
    return telHref(phone);
  }

  back() {
    this.router.navigate(["/clients"]);
  }

  newNote() {
    this.router.navigate(["/soap-notes"], { queryParams: { client: this.clientId() } });
  }

  confirmDelete(event: Event) {
    const client = this.client();
    if (!client) return;
    this.confirmation.confirm({
      target: event.currentTarget as EventTarget,
      message: `Delete ${client.name} and all their session notes?`,
      acceptLabel: "Delete",
      rejectLabel: "Keep",
      accept: () => {
        this.clients.deleteClientMutation.mutate(client.id, {
          onSuccess: () => {
            this.messages.add({ severity: "success", summary: "Client deleted" });
            this.back();
          },
          onError: (error) => {
            this.feedback.trigger("error");
            this.messages.add({
              severity: "error",
              summary: "Something went wrong",
              detail: error.message,
            });
          },
        });
      },
    });
  }
}
