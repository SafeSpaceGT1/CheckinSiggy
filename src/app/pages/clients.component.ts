import { QueryErrorComponent } from "../ui/query-error.component";
import { Component, computed, inject, signal } from "@angular/core";
import { RouterLink } from "@angular/router";
import { FormsModule } from "@angular/forms";
import { ChevronRight, LucideAngularModule, Trash2, Users } from "lucide-angular";
import { ConfirmationService, MessageService } from "primeng/api";
import { ButtonModule } from "primeng/button";
import { ConfirmPopupModule } from "primeng/confirmpopup";
import { InputTextModule } from "primeng/inputtext";
import { SkeletonModule } from "primeng/skeleton";
import { ClientsService, type Client } from "../core/clients.service";
import { FeedbackService } from "../core/feedback.service";
import { PageContainerComponent } from "../layout/page-container.component";
import { ClinicianGateComponent } from "../ui/clinician-gate.component";

@Component({
  selector: "app-clients",
  standalone: true,
  imports: [QueryErrorComponent,
    RouterLink,
    FormsModule,
    LucideAngularModule,
    ButtonModule,
    ConfirmPopupModule,
    InputTextModule,
    SkeletonModule,
    PageContainerComponent,
    ClinicianGateComponent,
  ],
  template: `
    <app-page-container maxWidth="md">
      <header class="animate-fade-in-up">
        <h1 class="text-3xl">Clients</h1>
        <p class="mt-2 text-sm text-muted-foreground">
          Your caseload, and a door into each person's notes.
        </p>
      </header>

      <app-clinician-gate>
        <section class="mt-6 animate-fade-in-up" style="animation-delay: 60ms">
          <div class="flex items-center gap-2">
            <input
              pInputText
              class="w-full flex-1"
              placeholder="Search by name or email"
              aria-label="Search clients"
              [ngModel]="query()"
              (ngModelChange)="query.set($event)"
            />
            @if (!showForm()) {
              <p-button label="Add" icon="pi pi-plus" (onClick)="showForm.set(true)" />
            }
          </div>

          @if (showForm()) {
            <div class="glass-card mt-3 animate-scale-in p-5">
              <label class="text-sm font-medium" for="client-name">Name</label>
              <input
                pInputText
                id="client-name"
                class="mt-2 w-full"
                placeholder="Full name"
                [ngModel]="formName()" [disabled]="clients.addClientMutation.isPending()"
                (ngModelChange)="formName.set($event)"
              />
              <div class="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <input
                  pInputText
                  type="email"
                  class="w-full"
                  placeholder="Email (optional)"
                  aria-label="Client email"
                  [ngModel]="formEmail()" [disabled]="clients.addClientMutation.isPending()"
                  (ngModelChange)="formEmail.set($event)"
                />
                <input
                  pInputText
                  type="tel"
                  class="w-full"
                  placeholder="Phone (optional)"
                  aria-label="Client phone"
                  [ngModel]="formPhone()" [disabled]="clients.addClientMutation.isPending()"
                  (ngModelChange)="formPhone.set($event)"
                />
              </div>
              <div class="mt-4 flex gap-2">
                <p-button
                  label="Add client"
                  styleClass="flex-1 w-full btn-glow"
                  class="block flex-1"
                  [disabled]="!formName().trim()"
                  [loading]="clients.addClientMutation.isPending()"
                  (onClick)="add()"
                />
                <p-button label="Cancel" [text]="true" (onClick)="showForm.set(false)" />
              </div>
            </div>
          }

          <div class="mt-4 space-y-3">
            @if (clients.clientsQuery.isPending()) {
              @for (i of [0, 1, 2]; track i) {
                <p-skeleton height="76px" borderRadius="1rem" />
              }
            } @else if (clients.clientsQuery.isError()) {
            <app-query-error message="Couldn't load your clients" (retry)="clients.clientsQuery.refetch()" />
          } @else if (filtered().length === 0) {
              <div class="empty-state">
                <div class="empty-state-icon">
                  <lucide-icon [img]="icons.Users" [size]="24" />
                </div>
                <p class="font-medium">
                  {{ query().trim() ? "No matches" : "No clients yet" }}
                </p>
                <p class="max-w-xs text-sm text-muted-foreground">
                  {{
                    query().trim()
                      ? "Try a different name or clear the search."
                      : "Add your first client to start keeping session notes."
                  }}
                </p>
              </div>
            } @else {
              @for (client of filtered(); track client.id) {
                <div class="glass-card flex items-center gap-1 p-1.5 pr-2">
                  <a
                    [routerLink]="['/client-profile', client.id]"
                    class="flex min-w-0 flex-1 items-center gap-3 rounded-xl p-2.5 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span
                      class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-primary text-sm font-semibold text-primary-foreground"
                    >
                      {{ initials(client) }}
                    </span>
                    <span class="min-w-0 flex-1">
                      <span class="block truncate text-sm font-medium">{{ client.name }}</span>
                      <span class="block truncate text-xs text-muted-foreground">
                        {{ client.email || client.phone || "No contact info" }}
                      </span>
                    </span>
                    <span
                      class="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
                    >
                      {{ noteCount(client.id) }} {{ noteCount(client.id) === 1 ? "note" : "notes" }}
                    </span>
                    <lucide-icon
                      [img]="icons.ChevronRight"
                      [size]="18"
                      class="shrink-0 text-muted-foreground"
                    />
                  </a>
                  <button
                    type="button"
                    (click)="confirmDelete($event, client)"
                    class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
                    aria-label="Delete client"
                  >
                    <lucide-icon [img]="icons.Trash2" [size]="15" />
                  </button>
                </div>
              }
            }
          </div>
        </section>
      </app-clinician-gate>
    </app-page-container>

    <p-confirmpopup />
  `,
})
export class ClientsComponent {
  readonly icons = { Users, ChevronRight, Trash2 };

  readonly clients = inject(ClientsService);
  private readonly feedback = inject(FeedbackService);
  private readonly messages = inject(MessageService);
  private readonly confirmation = inject(ConfirmationService);

  readonly query = signal("");
  readonly showForm = signal(false);
  readonly formName = signal("");
  readonly formEmail = signal("");
  readonly formPhone = signal("");

  readonly filtered = computed(() => {
    const term = this.query().trim().toLowerCase();
    const list = this.clients.clientsQuery.data() ?? [];
    if (!term) return list;
    return list.filter(
      (client) =>
        client.name.toLowerCase().includes(term) ||
        (client.email ?? "").toLowerCase().includes(term)
    );
  });

  private readonly noteCounts = computed(() => {
    const counts = new Map<string, number>();
    for (const note of this.clients.notesQuery.data() ?? []) {
      counts.set(note.client_id, (counts.get(note.client_id) ?? 0) + 1);
    }
    return counts;
  });

  noteCount(clientId: string): number {
    return this.noteCounts().get(clientId) ?? 0;
  }

  initials(client: Client): string {
    return client.name
      .split(/\s+/)
      .map((part) => part[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase();
  }

  add() {
    if (!this.formName().trim() || this.clients.addClientMutation.isPending()) return;
    this.clients.addClientMutation.mutate(
      {
        name: this.formName().trim(),
        email: this.formEmail().trim() || null,
        phone: this.formPhone().trim() || null,
      },
      {
        onSuccess: () => {
          this.feedback.trigger("success");
          this.messages.add({ severity: "success", summary: "Client added" });
          this.formName.set("");
          this.formEmail.set("");
          this.formPhone.set("");
          this.showForm.set(false);
        },
        onError: (error) => this.fail(error),
      }
    );
  }

  confirmDelete(event: Event, client: Client) {
    this.confirmation.confirm({
      target: event.currentTarget as EventTarget,
      message: `Delete ${client.name} and all their session notes?`,
      acceptLabel: "Delete",
      rejectLabel: "Keep",
      accept: () => {
        this.clients.deleteClientMutation.mutate(client.id, {
          onSuccess: () => this.messages.add({ severity: "success", summary: "Client deleted" }),
          onError: (error) => this.fail(error),
        });
      },
    });
  }

  private fail(error: Error) {
    this.feedback.trigger("error");
    this.messages.add({ severity: "error", summary: "Something went wrong", detail: error.message });
  }
}
