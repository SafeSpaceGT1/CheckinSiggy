import { QueryErrorComponent } from "../ui/query-error.component";
import { toSignal } from "@angular/core/rxjs-interop";
import { map } from "rxjs";
import { Component, inject } from "@angular/core";
import { ActivatedRoute } from "@angular/router";
import { injectQuery } from "@tanstack/angular-query-experimental";
import { HeartPulse, LucideAngularModule, TriangleAlert } from "lucide-angular";
import { SkeletonModule } from "primeng/skeleton";
import { supabase, supabaseConfigured } from "../core/supabase.client";
import {
  EMERGENCY_DISCLAIMER,
  emptyBundle,
  type PlanBundle,
} from "../core/crisis-plan.service";
import { CrisisPlanViewComponent } from "../ui/crisis-plan-view.component";

interface SharedRow {
  text?: string;
  name?: string;
  phone?: string | null;
  kind?: "person" | "place";
  relationship?: string | null;
  organization?: string | null;
}

interface SharedPayload {
  warning_signs?: SharedRow[];
  coping_strategies?: SharedRow[];
  distractions?: SharedRow[];
  support_contacts?: SharedRow[];
  professional_contacts?: SharedRow[];
  safety_steps?: SharedRow[];
  reasons_for_living?: SharedRow[];
}

function toBundle(payload: SharedPayload): PlanBundle {
  const bundle = emptyBundle();
  bundle.warningSigns = (payload.warning_signs ?? []).map((row) => ({ text: row.text ?? "" }));
  bundle.copingStrategies = (payload.coping_strategies ?? []).map((row) => ({
    text: row.text ?? "",
  }));
  bundle.distractions = (payload.distractions ?? []).map((row) => ({
    name: row.name ?? "",
    phone: row.phone ?? null,
    kind: row.kind === "place" ? "place" : "person",
  }));
  bundle.supportContacts = (payload.support_contacts ?? []).map((row) => ({
    name: row.name ?? "",
    phone: row.phone ?? null,
    relationship: row.relationship ?? null,
  }));
  bundle.professionalContacts = (payload.professional_contacts ?? []).map((row) => ({
    name: row.name ?? "",
    organization: row.organization ?? null,
    phone: row.phone ?? null,
  }));
  bundle.safetySteps = (payload.safety_steps ?? []).map((row) => ({ text: row.text ?? "" }));
  bundle.reasonsForLiving = (payload.reasons_for_living ?? []).map((row) => ({
    text: row.text ?? "",
  }));
  return bundle;
}

/**
 * Public, read-only plan view. The token grants access to exactly one plan
 * via the security-definer get_shared_plan() RPC — no sign-in required.
 */
@Component({
  selector: "app-shared-plan",
  standalone: true,
  imports: [QueryErrorComponent,LucideAngularModule, SkeletonModule, CrisisPlanViewComponent],
  template: `
    <div class="mx-auto w-full max-w-2xl px-4 py-8 md:px-6">
      <header class="animate-fade-in-up text-center">
        <span
          class="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-primary shadow-glow"
        >
          <lucide-icon [img]="icons.HeartPulse" [size]="24" class="text-primary-foreground" />
        </span>
        <h1 class="text-2xl">Shared crisis plan</h1>
        <p class="mt-1 text-xs text-muted-foreground">
          Shared from Check-In with SIGGY · read-only
        </p>
      </header>

      <div
        class="mt-5 flex items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-4 animate-fade-in-up"
      >
        <lucide-icon
          [img]="icons.TriangleAlert"
          [size]="18"
          class="mt-0.5 shrink-0 text-destructive"
        />
        <p class="text-xs leading-relaxed text-muted-foreground">{{ disclaimer }}</p>
      </div>

      <div class="mt-6">
        @if (sharedQuery.isPending()) {
          <div class="space-y-3">
            <p-skeleton height="120px" borderRadius="1rem" />
            <p-skeleton height="120px" borderRadius="1rem" />
          </div>
        } @else if (sharedQuery.isError()) {
          <app-query-error message="Couldn't load this shared plan" (retry)="sharedQuery.refetch()" />
        } @else if (!sharedQuery.data()) {
          <div class="empty-state animate-fade-in-up">
            <span class="text-3xl">🔗</span>
            <p class="font-medium">This link isn't available</p>
            <p class="max-w-xs text-sm text-muted-foreground">
              It may have expired or been revoked. Ask the person who shared it for a new link.
            </p>
          </div>
        } @else {
          <app-crisis-plan-view [bundle]="sharedQuery.data()!" />
        }
      </div>
    </div>
  `,
})
export class SharedPlanComponent {
  readonly icons = { HeartPulse, TriangleAlert };
  readonly disclaimer = EMERGENCY_DISCLAIMER;

  private readonly route = inject(ActivatedRoute);
  private readonly token = toSignal(
    this.route.paramMap.pipe(map((params) => params.get("token") ?? "")),
    { initialValue: this.route.snapshot.paramMap.get("token") ?? "" }
  );

  readonly sharedQuery = injectQuery(() => ({
    queryKey: ["shared-plan", this.token()],
    enabled: this.token().length > 0,
    retry: 0,
    queryFn: async (): Promise<PlanBundle | null> => {
      if (!supabaseConfigured) throw new Error("The account service is not configured.");
      const { data, error } = await supabase.rpc("get_shared_plan", {
        share_token: this.token(),
      });
      if (error) throw new Error(error.message);
      if (!data) return null;
      return toBundle(data as SharedPayload);
    },
  }));
}
