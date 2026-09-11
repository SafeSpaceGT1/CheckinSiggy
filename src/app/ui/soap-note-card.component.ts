import { Component, computed, inject, input, signal } from "@angular/core";
import { format } from "date-fns";
import { LucideAngularModule, Trash2 } from "lucide-angular";
import { ConfirmationService, MessageService } from "primeng/api";
import {
  ClientsService,
  NOTE_FORMATS,
  type NoteFormat,
  type SoapNote,
} from "../core/clients.service";
import { FeedbackService } from "../core/feedback.service";

/** One session note: format badge, date, collapsible sections, delete. */
@Component({
  selector: "app-soap-note-card",
  standalone: true,
  imports: [LucideAngularModule],
  template: `
    <article class="glass-card p-4">
      <div class="flex flex-wrap items-center gap-2">
        <span [class]="formatBadge()">{{ note().format }}</span>
        <span class="text-xs text-muted-foreground">{{ dateLabel() }}</span>
        @if (clientName()) {
          <span class="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
            {{ clientName() }}
          </span>
        }
        <span class="flex-1"></span>
        <button
          type="button"
          (click)="confirmDelete($event)"
          class="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
          aria-label="Delete note"
        >
          <lucide-icon [img]="Trash2" [size]="15" />
        </button>
      </div>

      @if (expanded()) {
        <div class="mt-3 space-y-3">
          @for (section of filledSections(); track section.key) {
            <div>
              <p class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {{ section.label }}
              </p>
              <p class="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed">{{ section.text }}</p>
            </div>
          }
        </div>
      } @else if (preview()) {
        <div class="mt-3">
          <p class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {{ preview()!.label }}
          </p>
          <p class="mt-0.5 line-clamp-2 text-sm leading-relaxed">{{ preview()!.text }}</p>
        </div>
      }

      @if (filledSections().length > 0) {
        <button
          type="button"
          (click)="expanded.set(!expanded())"
          class="mt-2 text-xs font-medium text-primary hover:underline"
        >
          {{ expanded() ? "Collapse" : "Show full note" }}
        </button>
      }
    </article>
  `,
})
export class SoapNoteCardComponent {
  readonly Trash2 = Trash2;
  readonly note = input.required<SoapNote>();
  readonly clientName = input<string | null>(null);

  readonly expanded = signal(false);

  private readonly clients = inject(ClientsService);
  private readonly feedback = inject(FeedbackService);
  private readonly messages = inject(MessageService);
  private readonly confirmation = inject(ConfirmationService);

  readonly filledSections = computed(() => {
    const note = this.note();
    return NOTE_FORMATS[note.format]
      .map((section) => ({
        key: section.key,
        label: section.label,
        text: (note.content[section.key] ?? "").trim(),
      }))
      .filter((section) => section.text.length > 0);
  });

  readonly preview = computed(() => this.filledSections()[0] ?? null);

  readonly dateLabel = computed(() =>
    format(new Date(`${this.note().session_date}T12:00:00`), "MMM d, yyyy")
  );

  formatBadge(): string {
    const base = "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold";
    const map: Record<NoteFormat, string> = {
      SOAP: `${base} bg-gradient-primary-soft text-primary`,
      DAP: `${base} bg-secondary/15 text-secondary`,
      BIRP: `${base} bg-warning/15 text-warning-foreground dark:text-warning`,
    };
    return map[this.note().format];
  }

  confirmDelete(event: Event) {
    this.confirmation.confirm({
      target: event.currentTarget as EventTarget,
      message: "Delete this session note?",
      acceptLabel: "Delete",
      rejectLabel: "Keep",
      accept: () => {
        this.clients.deleteNoteMutation.mutate(this.note().id, {
          onSuccess: () => {
            this.feedback.trigger("tap");
            this.messages.add({ severity: "success", summary: "Note deleted" });
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
