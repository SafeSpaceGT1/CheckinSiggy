import { QueryErrorComponent } from "../ui/query-error.component";
import { Component, computed, effect, inject, signal } from "@angular/core";
import { NgTemplateOutlet } from "@angular/common";
import { Router } from "@angular/router";
import { FormsModule } from "@angular/forms";
import { ArrowLeft, LucideAngularModule, Plus, Trash2 } from "lucide-angular";
import { ConfirmationService, MessageService } from "primeng/api";
import { ButtonModule } from "primeng/button";
import { ConfirmPopupModule } from "primeng/confirmpopup";
import { InputTextModule } from "primeng/inputtext";
import { SkeletonModule } from "primeng/skeleton";
import { CrisisPlanService } from "../core/crisis-plan.service";
import { FeedbackService } from "../core/feedback.service";
import { PageContainerComponent } from "../layout/page-container.component";

type TextSectionKey = "warning" | "coping" | "safety" | "reasons";

interface TextSectionMeta {
  key: TextSectionKey;
  table:
    | "crisis_warning_signs"
    | "crisis_coping_strategies"
    | "crisis_safety_steps"
    | "crisis_reasons_for_living";
  number: string;
  title: string;
  subtitle: string;
  placeholder: string;
}

const TEXT_SECTIONS: TextSectionMeta[] = [
  {
    key: "warning",
    table: "crisis_warning_signs",
    number: "1",
    title: "Warning signs",
    subtitle: "Thoughts, moods, or situations that signal a crisis may be building",
    placeholder: "e.g. Skipping meals and going quiet",
  },
  {
    key: "coping",
    table: "crisis_coping_strategies",
    number: "2",
    title: "Things I can do myself",
    subtitle: "Coping that doesn't need anyone else",
    placeholder: "e.g. Shower, playlist, walk around the block",
  },
  {
    key: "safety",
    table: "crisis_safety_steps",
    number: "6",
    title: "Making my space safer",
    subtitle: "Small changes that lower the temperature",
    placeholder: "e.g. Give spare keys to my sister",
  },
  {
    key: "reasons",
    table: "crisis_reasons_for_living",
    number: "♥",
    title: "Worth remembering",
    subtitle: "Reasons for living, in your words",
    placeholder: "e.g. Sunday mornings with my dog",
  },
];

@Component({
  selector: "app-crisis-plan-edit",
  standalone: true,
  imports: [QueryErrorComponent,
    NgTemplateOutlet,
    FormsModule,
    LucideAngularModule,
    ButtonModule,
    ConfirmPopupModule,
    InputTextModule,
    SkeletonModule,
    PageContainerComponent,
  ],
  template: `
    <app-page-container maxWidth="md">
      <header class="animate-fade-in-up">
        <p-button
          label="Back to plan"
          icon="pi pi-arrow-left"
          [text]="true"
          size="small"
          (onClick)="done()"
        />
        <h1 class="mt-2 text-3xl">Edit crisis plan</h1>
        <p class="mt-2 text-sm text-muted-foreground">
          Everything saves as you add it. Short and honest beats complete.
        </p>
      </header>

      @if (crisis.loading() || crisis.createPlanMutation.isPending()) {
        <div class="mt-6 space-y-3">
          <p-skeleton height="140px" borderRadius="1rem" />
          <p-skeleton height="140px" borderRadius="1rem" />
        </div>
      } @else if (crisis.loadError() || crisis.createPlanMutation.isError()) {
        <div class="mt-6"><app-query-error message="Couldn't prepare your crisis plan" (retry)="retryLoad()" /></div>
      } @else if (crisis.planQuery.data()) {
        <div class="mt-6 space-y-4">
          <!-- Text sections 1 & 2 -->
          @for (section of textSections.slice(0, 2); track section.key) {
            <ng-container
              *ngTemplateOutlet="textSection; context: { $implicit: section }"
            ></ng-container>
          }

          <!-- 3. Distractions -->
          <section class="glass-card animate-fade-in-up p-5">
            <div class="flex items-center gap-3">
              <span [class]="numberChip">3</span>
              <div>
                <h2 class="text-lg leading-tight">People & places for distraction</h2>
                <p class="text-xs text-muted-foreground">Company and settings that help</p>
              </div>
            </div>
            <div class="mt-3 space-y-2">
              @for (item of crisis.bundle().distractions; track item.id) {
                <div class="flex items-center gap-2 rounded-xl bg-muted/50 px-3 py-2">
                  <div class="min-w-0 flex-1">
                    <p class="text-sm font-medium">{{ item.name }}</p>
                    <p class="text-xs text-muted-foreground">
                      <span class="capitalize">{{ item.kind }}</span>
                      @if (item.phone) {
                        · {{ item.phone }}
                      }
                    </p>
                  </div>
                  <button
                    type="button"
                    (click)="removeItem($event, 'crisis_distractions', item.id!)"
                    [class]="trashButton"
                    aria-label="Remove"
                  >
                    <lucide-icon [img]="icons.Trash2" [size]="15" />
                  </button>
                </div>
              }
            </div>
            <div class="mt-3 space-y-2">
              <div class="flex gap-2">
                <button type="button" (click)="dKind.set('person')" [class]="kindChip('person')">
                  Person
                </button>
                <button type="button" (click)="dKind.set('place')" [class]="kindChip('place')">
                  Place
                </button>
              </div>
              <input
                pInputText
                [disabled]="adding()"
                class="w-full"
                [placeholder]="dKind() === 'place' ? 'Place — e.g. The park by the river' : 'Name — e.g. Marcus'"
                aria-label="Distraction name"
                [ngModel]="dName()"
                (ngModelChange)="dName.set($event)"
              />
              @if (dKind() === "person") {
                <input
                  pInputText
                  [disabled]="adding()"
                  type="tel"
                  class="w-full"
                  placeholder="Phone (optional)"
                  aria-label="Distraction phone"
                  [ngModel]="dPhone()"
                  (ngModelChange)="dPhone.set($event)"
                />
              }
              <p-button
                label="Add"
                icon="pi pi-plus"
                size="small"
                [outlined]="true"
                [disabled]="!dName().trim() || adding()"
                (onClick)="addDistraction()"
              />
            </div>
          </section>

          <!-- 4. Support contacts -->
          <section class="glass-card animate-fade-in-up p-5">
            <div class="flex items-center gap-3">
              <span [class]="numberChip">4</span>
              <div>
                <h2 class="text-lg leading-tight">People I can ask for help</h2>
                <p class="text-xs text-muted-foreground">Family and friends who show up</p>
              </div>
            </div>
            <div class="mt-3 space-y-2">
              @for (item of crisis.bundle().supportContacts; track item.id) {
                <div class="flex items-center gap-2 rounded-xl bg-muted/50 px-3 py-2">
                  <div class="min-w-0 flex-1">
                    <p class="text-sm font-medium">{{ item.name }}</p>
                    <p class="text-xs text-muted-foreground">
                      {{ item.relationship || "Contact" }}
                      @if (item.phone) {
                        · {{ item.phone }}
                      }
                    </p>
                  </div>
                  <button
                    type="button"
                    (click)="removeItem($event, 'crisis_support_contacts', item.id!)"
                    [class]="trashButton"
                    aria-label="Remove"
                  >
                    <lucide-icon [img]="icons.Trash2" [size]="15" />
                  </button>
                </div>
              }
            </div>
            <div class="mt-3 space-y-2">
              <input
                pInputText
                [disabled]="adding()"
                class="w-full"
                placeholder="Name"
                aria-label="Contact name"
                [ngModel]="sName()"
                (ngModelChange)="sName.set($event)"
              />
              <div class="grid grid-cols-2 gap-2">
                <input
                  pInputText
                  [disabled]="adding()"
                  class="w-full"
                  placeholder="Relationship (optional)"
                  aria-label="Relationship"
                  [ngModel]="sRelationship()"
                  (ngModelChange)="sRelationship.set($event)"
                />
                <input
                  pInputText
                  [disabled]="adding()"
                  type="tel"
                  class="w-full"
                  placeholder="Phone (optional)"
                  aria-label="Contact phone"
                  [ngModel]="sPhone()"
                  (ngModelChange)="sPhone.set($event)"
                />
              </div>
              <p-button
                label="Add"
                icon="pi pi-plus"
                size="small"
                [outlined]="true"
                [disabled]="!sName().trim() || adding()"
                (onClick)="addSupport()"
              />
            </div>
          </section>

          <!-- 5. Professionals -->
          <section class="glass-card animate-fade-in-up p-5">
            <div class="flex items-center gap-3">
              <span [class]="numberChip">5</span>
              <div>
                <h2 class="text-lg leading-tight">Professionals & agencies</h2>
                <p class="text-xs text-muted-foreground">Therapist, clinic, hotline — trained support</p>
              </div>
            </div>
            <div class="mt-3 space-y-2">
              @for (item of crisis.bundle().professionalContacts; track item.id) {
                <div class="flex items-center gap-2 rounded-xl bg-muted/50 px-3 py-2">
                  <div class="min-w-0 flex-1">
                    <p class="text-sm font-medium">{{ item.name }}</p>
                    <p class="text-xs text-muted-foreground">
                      {{ item.organization || "Professional" }}
                      @if (item.phone) {
                        · {{ item.phone }}
                      }
                    </p>
                  </div>
                  <button
                    type="button"
                    (click)="removeItem($event, 'crisis_professional_contacts', item.id!)"
                    [class]="trashButton"
                    aria-label="Remove"
                  >
                    <lucide-icon [img]="icons.Trash2" [size]="15" />
                  </button>
                </div>
              }
            </div>
            <div class="mt-3 space-y-2">
              <input
                pInputText
                [disabled]="adding()"
                class="w-full"
                placeholder="Name — e.g. Dr. Reyes"
                aria-label="Professional name"
                [ngModel]="pName()"
                (ngModelChange)="pName.set($event)"
              />
              <div class="grid grid-cols-2 gap-2">
                <input
                  pInputText
                  [disabled]="adding()"
                  class="w-full"
                  placeholder="Organization (optional)"
                  aria-label="Organization"
                  [ngModel]="pOrganization()"
                  (ngModelChange)="pOrganization.set($event)"
                />
                <input
                  pInputText
                  [disabled]="adding()"
                  type="tel"
                  class="w-full"
                  placeholder="Phone (optional)"
                  aria-label="Professional phone"
                  [ngModel]="pPhone()"
                  (ngModelChange)="pPhone.set($event)"
                />
              </div>
              <p-button
                label="Add"
                icon="pi pi-plus"
                size="small"
                [outlined]="true"
                [disabled]="!pName().trim() || adding()"
                (onClick)="addProfessional()"
              />
            </div>
          </section>

          <!-- Text sections 6 & reasons -->
          @for (section of textSections.slice(2); track section.key) {
            <ng-container
              *ngTemplateOutlet="textSection; context: { $implicit: section }"
            ></ng-container>
          }

          <p-button
            label="Done — view my plan"
            styleClass="w-full btn-glow"
            class="block w-full"
            (onClick)="done()"
          />
        </div>
      }

      <ng-template #textSection let-section>
        <section class="glass-card animate-fade-in-up p-5">
          <div class="flex items-center gap-3">
            <span [class]="numberChip">{{ section.number }}</span>
            <div>
              <h2 class="text-lg leading-tight">{{ section.title }}</h2>
              <p class="text-xs text-muted-foreground">{{ section.subtitle }}</p>
            </div>
          </div>
          <div class="mt-3 space-y-2">
            @for (item of textItems(section.key); track item.id) {
              <div class="flex items-center gap-2 rounded-xl bg-muted/50 px-3 py-2">
                <p class="min-w-0 flex-1 text-sm">{{ item.text }}</p>
                <button
                  type="button"
                  (click)="removeItem($event, section.table, item.id!)"
                  [class]="trashButton"
                  aria-label="Remove"
                >
                  <lucide-icon [img]="icons.Trash2" [size]="15" />
                </button>
              </div>
            }
          </div>
          <div class="mt-3 flex gap-2">
            <input
              pInputText
              [disabled]="adding()"
              class="w-full flex-1"
              [placeholder]="section.placeholder"
              [attr.aria-label]="'Add to ' + section.title"
              [ngModel]="textDraft(section.key)"
              (ngModelChange)="setTextDraft(section.key, $event)"
              (keyup.enter)="addText(section)"
            />
            <p-button
              icon="pi pi-plus"
              [outlined]="true"
              [disabled]="!textDraft(section.key).trim() || adding()"
              (onClick)="addText(section)"
              ariaLabel="Add item"
            />
          </div>
        </section>
      </ng-template>
    </app-page-container>

    <p-confirmpopup />
  `,
})
export class CrisisPlanEditComponent {
  readonly icons = { Trash2, Plus, ArrowLeft };
  readonly textSections = TEXT_SECTIONS;

  readonly crisis = inject(CrisisPlanService);
  private readonly router = inject(Router);
  private readonly feedback = inject(FeedbackService);
  private readonly messages = inject(MessageService);
  private readonly confirmation = inject(ConfirmationService);

  readonly numberChip =
    "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-primary font-display text-lg text-primary-foreground shadow-glow";
  readonly trashButton =
    "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive";

  private readonly textDrafts = signal<Record<TextSectionKey, string>>({
    warning: "",
    coping: "",
    safety: "",
    reasons: "",
  });

  readonly dKind = signal<"person" | "place">("person");
  readonly dName = signal("");
  readonly dPhone = signal("");
  readonly sName = signal("");
  readonly sPhone = signal("");
  readonly sRelationship = signal("");
  readonly pName = signal("");
  readonly pOrganization = signal("");
  readonly pPhone = signal("");

  private readonly savingItem = signal(false);
  readonly adding = computed(() => this.savingItem() || this.crisis.addItemMutation.isPending());

  private createAttempted = false;

  constructor() {
    // First visit: quietly create the plan row so items have a home.
    effect(() => {
      const loaded = this.crisis.planQuery.isSuccess();
      const plan = this.crisis.planQuery.data();
      if (loaded && !plan && !this.createAttempted) {
        this.createAttempted = true;
        this.crisis.createPlanMutation.mutate(undefined, { onError: (error) => this.fail(error) });
      }
    });
  }

  async retryLoad() {
    if (this.crisis.createPlanMutation.isPending()) return;
    await Promise.all([
      this.crisis.planQuery.refetch(), this.crisis.warningSignsQuery.refetch(),
      this.crisis.copingStrategiesQuery.refetch(), this.crisis.distractionsQuery.refetch(),
      this.crisis.supportContactsQuery.refetch(), this.crisis.professionalContactsQuery.refetch(),
      this.crisis.safetyStepsQuery.refetch(), this.crisis.reasonsQuery.refetch(),
    ]);
    if (this.crisis.planQuery.isSuccess() && !this.crisis.planQuery.data()) {
      this.createAttempted = true;
      this.crisis.createPlanMutation.mutate(undefined, { onError: (error) => this.fail(error) });
    } else if (this.crisis.planQuery.data()) {
      this.crisis.createPlanMutation.reset();
    }
  }

  textItems(key: TextSectionKey) {
    const bundle = this.crisis.bundle();
    switch (key) {
      case "warning":
        return bundle.warningSigns;
      case "coping":
        return bundle.copingStrategies;
      case "safety":
        return bundle.safetySteps;
      case "reasons":
        return bundle.reasonsForLiving;
    }
  }

  textDraft(key: TextSectionKey): string {
    return this.textDrafts()[key];
  }

  setTextDraft(key: TextSectionKey, value: string) {
    this.textDrafts.update((drafts) => ({ ...drafts, [key]: value }));
  }

  kindChip(kind: "person" | "place"): string {
    const base =
      "min-h-[40px] flex-1 rounded-full border px-3 py-1.5 text-xs font-medium transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
    return this.dKind() === kind
      ? `${base} border-transparent bg-gradient-primary text-primary-foreground shadow-glow`
      : `${base} border-border/60 bg-card/70 hover:border-primary/40`;
  }

  addText(section: TextSectionMeta) {
    const text = this.textDraft(section.key).trim();
    if (!text || this.adding() || !this.crisis.planQuery.data()) return;
    this.savingItem.set(true);
    this.crisis.addItemMutation.mutate(
      {
        table: section.table,
        values: { text },
        position: this.textItems(section.key).length,
      },
      {
        onSuccess: () => {
          this.feedback.trigger("tap");
          this.setTextDraft(section.key, "");
        },
        onError: (error) => this.fail(error),
        onSettled: () => this.savingItem.set(false),
      }
    );
  }

  addDistraction() {
    if (!this.dName().trim() || this.adding() || !this.crisis.planQuery.data()) return;
    this.savingItem.set(true);
    this.crisis.addItemMutation.mutate(
      {
        table: "crisis_distractions",
        values: {
          name: this.dName().trim(),
          phone: this.dKind() === "person" ? this.dPhone().trim() || null : null,
          kind: this.dKind(),
        },
        position: this.crisis.bundle().distractions.length,
      },
      {
        onSuccess: () => {
          this.feedback.trigger("tap");
          this.dName.set("");
          this.dPhone.set("");
        },
        onError: (error) => this.fail(error),
        onSettled: () => this.savingItem.set(false),
      }
    );
  }

  addSupport() {
    if (!this.sName().trim() || this.adding() || !this.crisis.planQuery.data()) return;
    this.savingItem.set(true);
    this.crisis.addItemMutation.mutate(
      {
        table: "crisis_support_contacts",
        values: {
          name: this.sName().trim(),
          phone: this.sPhone().trim() || null,
          relationship: this.sRelationship().trim() || null,
        },
        position: this.crisis.bundle().supportContacts.length,
      },
      {
        onSuccess: () => {
          this.feedback.trigger("tap");
          this.sName.set("");
          this.sPhone.set("");
          this.sRelationship.set("");
        },
        onError: (error) => this.fail(error),
        onSettled: () => this.savingItem.set(false),
      }
    );
  }

  addProfessional() {
    if (!this.pName().trim() || this.adding() || !this.crisis.planQuery.data()) return;
    this.savingItem.set(true);
    this.crisis.addItemMutation.mutate(
      {
        table: "crisis_professional_contacts",
        values: {
          name: this.pName().trim(),
          organization: this.pOrganization().trim() || null,
          phone: this.pPhone().trim() || null,
        },
        position: this.crisis.bundle().professionalContacts.length,
      },
      {
        onSuccess: () => {
          this.feedback.trigger("tap");
          this.pName.set("");
          this.pOrganization.set("");
          this.pPhone.set("");
        },
        onError: (error) => this.fail(error),
        onSettled: () => this.savingItem.set(false),
      }
    );
  }

  removeItem(event: Event, table: string, id: string) {
    this.confirmation.confirm({
      target: event.currentTarget as EventTarget,
      message: "Remove this item?",
      acceptLabel: "Remove",
      rejectLabel: "Keep",
      accept: () => {
        this.crisis.deleteItemMutation.mutate(
          { table: table as never, id },
          { onError: (error) => this.fail(error) }
        );
      },
    });
  }

  done() {
    if (this.adding() || this.crisis.deleteItemMutation.isPending()) return;
    this.router.navigate(["/crisis-plan"]);
  }

  private fail(error: Error) {
    this.feedback.trigger("error");
    this.messages.add({ severity: "error", summary: "Something went wrong", detail: error.message });
  }
}
