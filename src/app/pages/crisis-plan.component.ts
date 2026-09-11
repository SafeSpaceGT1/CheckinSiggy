import { QueryErrorComponent } from "../ui/query-error.component";
import { Component, computed, inject, signal } from "@angular/core";
import { Router } from "@angular/router";
import { format } from "date-fns";
import {
  Copy,
  Download,
  Flower2,
  Leaf,
  LifeBuoy,
  LucideAngularModule,
  Pencil,
  Phone,
  Share2,
  TriangleAlert,
  XCircle,
} from "lucide-angular";
import { MessageService } from "primeng/api";
import { ButtonModule } from "primeng/button";
import { DialogModule } from "primeng/dialog";
import { SkeletonModule } from "primeng/skeleton";
import {
  bundleIsEmpty,
  CrisisPlanService,
  EMERGENCY_DISCLAIMER,
  type PlanShare,
} from "../core/crisis-plan.service";
import { exportCrisisPlanPdf } from "../core/crisis-pdf";
import { SettingsService } from "../core/settings.service";
import { FeedbackService } from "../core/feedback.service";
import { PageContainerComponent } from "../layout/page-container.component";
import { CrisisPlanViewComponent } from "../ui/crisis-plan-view.component";
import { CrisisFlowComponent } from "../ui/crisis-flow.component";
import { BreathingRingComponent } from "../ui/breathing-ring.component";
import { GroundingStepsComponent } from "../ui/grounding-steps.component";

@Component({
  selector: "app-crisis-plan",
  standalone: true,
  imports: [QueryErrorComponent,
    LucideAngularModule,
    ButtonModule,
    DialogModule,
    SkeletonModule,
    PageContainerComponent,
    CrisisPlanViewComponent,
    CrisisFlowComponent,
    BreathingRingComponent,
    GroundingStepsComponent,
  ],
  template: `
    <app-page-container maxWidth="md">
      <header class="animate-fade-in-up">
        <h1 class="text-3xl">Crisis plan</h1>
        <p class="mt-2 text-sm text-muted-foreground">
          You built this for moments like now. It's all here.
        </p>
      </header>

      <section class="mt-5 animate-fade-in-up" style="animation-delay: 40ms" aria-label="Emergency">
        <div class="rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
          <div class="flex items-start gap-3">
            <lucide-icon [img]="icons.TriangleAlert" [size]="18" class="mt-0.5 shrink-0 text-destructive" />
            <div class="min-w-0">
              <p class="text-sm font-semibold">If you're in immediate danger</p>
              <p class="mt-0.5 text-xs text-muted-foreground">{{ disclaimer }}</p>
            </div>
          </div>
          <div class="mt-3 flex flex-wrap gap-2">
            <a href="tel:911" [class]="emergencyChip">
              <lucide-icon [img]="icons.Phone" [size]="14" /> 911 (US)
            </a>
            <a href="tel:999" [class]="emergencyChip">
              <lucide-icon [img]="icons.Phone" [size]="14" /> 999 (UK)
            </a>
            <a href="tel:988" [class]="lifelineChip">
              <lucide-icon [img]="icons.Phone" [size]="14" /> 988 Lifeline (US)
            </a>
          </div>
        </div>
      </section>

      <section class="mt-5 animate-fade-in-up" style="animation-delay: 80ms" aria-label="Support now">
        <button type="button" (click)="flowOpen.set(true)" [class]="flowButton">
          <lucide-icon [img]="icons.LifeBuoy" [size]="24" />
          <span class="text-left">
            <span class="block text-base font-semibold">Start crisis support</span>
            <span class="block text-xs opacity-90">Your plan, one calm step at a time</span>
          </span>
        </button>

        <div class="mt-3 grid grid-cols-2 gap-3">
          <button type="button" (click)="breatheOpen.set(true)" [class]="toolButton">
            <lucide-icon [img]="icons.Flower2" [size]="20" class="text-primary" />
            Breathe
          </button>
          <button type="button" (click)="groundOpen.set(true)" [class]="toolButton">
            <lucide-icon [img]="icons.Leaf" [size]="20" class="text-secondary" />
            Ground
          </button>
        </div>
      </section>

      <section class="mt-6 animate-fade-in-up" style="animation-delay: 120ms" aria-label="Your plan">
        @if (crisis.loading()) {
          <div class="space-y-3">
            <p-skeleton height="120px" borderRadius="1rem" />
            <p-skeleton height="120px" borderRadius="1rem" />
          </div>
        } @else if (crisis.loadError()) {
          <app-query-error message="Couldn't load your crisis plan" (retry)="reloadPlan()" />
        } @else if (isEmpty()) {
          <div class="empty-state">
            <div class="empty-state-icon">
              <lucide-icon [img]="icons.LifeBuoy" [size]="24" />
            </div>
            <p class="font-medium">Your plan, ready before you need it</p>
            <p class="max-w-xs text-sm text-muted-foreground">
              A few warning signs, some things that help, and the people you'd call — written
              on a good day, for a hard one.
            </p>
            <p-button label="Build my plan" styleClass="btn-glow mt-2" (onClick)="edit()" />
          </div>
        } @else {
          @if (needsReview()) {
            <div class="mb-4 flex items-center gap-3 rounded-2xl bg-gradient-primary-soft p-4">
              <span class="text-xl">🌿</span>
              <p class="flex-1 text-sm">
                It's been over {{ settings.reviewIntervalDays() }} days since this plan changed.
                A quick read-through keeps it current.
              </p>
              <p-button label="Review" size="small" [outlined]="true" (onClick)="edit()" />
            </div>
          }
          <div class="mb-4 flex flex-wrap gap-2">
            <p-button label="Edit" icon="pi pi-pencil" size="small" [outlined]="true" (onClick)="edit()" />
            <p-button
              label="Export PDF"
              icon="pi pi-download"
              size="small"
              [outlined]="true"
              [loading]="exporting()"
              (onClick)="exportPdf()"
            />
            <p-button
              label="Share"
              icon="pi pi-share-alt"
              size="small"
              [outlined]="true"
              (onClick)="shareOpen.set(true)"
            />
          </div>
          <app-crisis-plan-view [bundle]="crisis.bundle()" />
        }
      </section>
    </app-page-container>

    @if (flowOpen()) {
      <app-crisis-flow [bundle]="crisis.bundle()" (closed)="flowOpen.set(false)" />
    }

    <p-dialog
      header="4-7-8 Breathing"
      [visible]="breatheOpen()"
      (visibleChange)="breatheOpen.set($event)"
      [modal]="true"
      [draggable]="false"
      [resizable]="false"
      [style]="{ width: 'min(92vw, 400px)' }"
    >
      @if (breatheOpen()) {
        <app-breathing-ring />
      }
    </p-dialog>

    <p-dialog
      header="5-4-3-2-1 Grounding"
      [visible]="groundOpen()"
      (visibleChange)="groundOpen.set($event)"
      [modal]="true"
      [draggable]="false"
      [resizable]="false"
      [style]="{ width: 'min(92vw, 400px)' }"
    >
      @if (groundOpen()) {
        <app-grounding-steps />
      }
    </p-dialog>

    <p-dialog
      header="Share your plan"
      [visible]="shareOpen()"
      (visibleChange)="shareOpen.set($event)"
      [modal]="true"
      [draggable]="false"
      [resizable]="false"
      [style]="{ width: 'min(92vw, 440px)' }"
    >
      <p class="text-sm text-muted-foreground">
        Create a read-only link for a therapist, family member, or friend. You can revoke it
        anytime.
      </p>
      <div class="mt-3 flex gap-2">
        @for (option of expiryOptions; track option.label) {
          <button type="button" (click)="expiry.set(option.days)" [class]="expiryChipClass(option.days)">
            {{ option.label }}
          </button>
        }
      </div>
      <p-button
        label="Create link"
        styleClass="w-full btn-glow mt-4"
        class="mt-4 block w-full"
        [loading]="crisis.createShareMutation.isPending()"
        (onClick)="createShare()"
      />

      @if (crisis.sharesQuery.isError()) {
        <app-query-error message="Couldn't load your share links" (retry)="crisis.sharesQuery.refetch()" />
      }
      @if (activeShares().length > 0) {
        <p class="mt-5 text-sm font-medium">Active links</p>
        <div class="mt-2 space-y-2">
          @for (share of activeShares(); track share.id) {
            <div class="flex items-center gap-2 rounded-xl bg-muted/50 px-3 py-2.5">
              <div class="min-w-0 flex-1">
                <p class="truncate text-xs font-medium">{{ shareUrl(share.token) }}</p>
                <p class="text-[11px] text-muted-foreground">{{ expiryLabel(share) }}</p>
              </div>
              <button
                type="button"
                (click)="copy(shareUrl(share.token))"
                class="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                aria-label="Copy link"
              >
                <lucide-icon [img]="icons.Copy" [size]="15" />
              </button>
              <button
                type="button"
                (click)="revoke(share)"
                class="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                aria-label="Revoke link"
              >
                <lucide-icon [img]="icons.XCircle" [size]="15" />
              </button>
            </div>
          }
        </div>
      }
    </p-dialog>
  `,
})
export class CrisisPlanComponent {
  readonly icons = {
    LifeBuoy,
    Flower2,
    Leaf,
    Phone,
    TriangleAlert,
    Pencil,
    Download,
    Share2,
    Copy,
    XCircle,
  };
  readonly disclaimer = EMERGENCY_DISCLAIMER;
  readonly expiryOptions = [
    { label: "7 days", days: 7 as number | null },
    { label: "30 days", days: 30 as number | null },
    { label: "Never expires", days: null as number | null },
  ];

  readonly crisis = inject(CrisisPlanService);
  private readonly router = inject(Router);
  readonly settings = inject(SettingsService);
  private readonly feedback = inject(FeedbackService);
  private readonly messages = inject(MessageService);

  readonly flowOpen = signal(false);
  readonly breatheOpen = signal(false);
  readonly groundOpen = signal(false);
  readonly shareOpen = signal(false);
  readonly expiry = signal<number | null>(7);
  readonly exporting = signal(false);

  readonly isEmpty = computed(
    () => !this.crisis.planQuery.data() || bundleIsEmpty(this.crisis.bundle())
  );

  /** Older than the review interval (Settings)? Suggest a read-through — softly. */
  readonly needsReview = computed(() => {
    const plan = this.crisis.planQuery.data();
    if (!plan || this.isEmpty()) return false;
    const ageDays = (Date.now() - new Date(plan.updated_at).getTime()) / 86_400_000;
    return ageDays > this.settings.reviewIntervalDays();
  });
  readonly activeShares = computed(() => this.crisis.sharesQuery.data() ?? []);

  readonly emergencyChip =
    "flex min-h-[44px] items-center gap-1.5 rounded-full bg-destructive px-4 py-2 text-xs font-semibold text-destructive-foreground transition-transform hover:scale-105 active:scale-95";
  readonly lifelineChip =
    "flex min-h-[44px] items-center gap-1.5 rounded-full bg-gradient-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-transform hover:scale-105 active:scale-95";
  readonly flowButton =
    "flex w-full items-center gap-4 rounded-2xl bg-destructive p-5 text-destructive-foreground shadow-lg transition-transform hover:scale-[1.01] active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive focus-visible:ring-offset-2";
  readonly toolButton =
    "glass-card flex min-h-[56px] items-center justify-center gap-2 p-4 text-sm font-medium transition-all hover:-translate-y-0.5 hover:shadow-card-hover active:scale-[0.98]";

  reloadPlan() {
    return Promise.all([
      this.crisis.planQuery.refetch(), this.crisis.warningSignsQuery.refetch(),
      this.crisis.copingStrategiesQuery.refetch(), this.crisis.distractionsQuery.refetch(),
      this.crisis.supportContactsQuery.refetch(), this.crisis.professionalContactsQuery.refetch(),
      this.crisis.safetyStepsQuery.refetch(), this.crisis.reasonsQuery.refetch(),
    ]);
  }

  edit() {
    this.router.navigate(["/crisis-plan/edit"]);
  }

  expiryChipClass(days: number | null): string {
    const base =
      "min-h-[44px] flex-1 rounded-full border px-3 py-2 text-xs font-medium transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
    return this.expiry() === days
      ? `${base} border-transparent bg-gradient-primary text-primary-foreground shadow-glow`
      : `${base} border-border/60 bg-card/70 hover:border-primary/40`;
  }

  async exportPdf() {
    if (this.exporting() || this.crisis.loading() || this.crisis.loadError()) return;
    this.exporting.set(true);
    try {
      await exportCrisisPlanPdf(this.crisis.bundle());
      this.feedback.trigger("success");
      this.messages.add({ severity: "success", summary: "PDF downloaded" });
    } catch (error) {
      this.feedback.trigger("error");
      this.messages.add({
        severity: "error",
        summary: "Export failed",
        detail: (error as Error).message,
      });
    } finally {
      this.exporting.set(false);
    }
  }

  createShare() {
    if (this.crisis.createShareMutation.isPending() || this.crisis.loading() || this.crisis.loadError()) return;
    this.crisis.createShareMutation.mutate(this.expiry(), {
      onSuccess: (token) => {
        this.feedback.trigger("success");
        this.copy(this.shareUrl(token), "Link created and copied");
      },
      onError: (error) => this.fail(error),
    });
  }

  shareUrl(token: string): string {
    return `${window.location.origin}/shared-plan/${token}`;
  }

  expiryLabel(share: PlanShare): string {
    return share.expires_at
      ? `Expires ${format(new Date(share.expires_at), "MMM d, yyyy")}`
      : "Never expires";
  }

  async copy(url: string, summary = "Link copied") {
    try {
      await navigator.clipboard.writeText(url);
      this.messages.add({ severity: "success", summary });
    } catch {
      this.messages.add({ severity: "info", summary: "Copy this link", detail: url, life: 10000 });
    }
  }

  revoke(share: PlanShare) {
    this.crisis.revokeShareMutation.mutate(share.id, {
      onSuccess: () => this.messages.add({ severity: "success", summary: "Link revoked" }),
      onError: (error) => this.fail(error),
    });
  }

  private fail(error: Error) {
    this.feedback.trigger("error");
    this.messages.add({ severity: "error", summary: "Something went wrong", detail: error.message });
  }
}
