import { Component, computed, inject, signal } from "@angular/core";
import { format } from "date-fns";
import { Download, LucideAngularModule } from "lucide-angular";
import { MessageService } from "primeng/api";
import { ButtonModule } from "primeng/button";
import { supabase } from "../core/supabase.client";
import { isDemoMode } from "../core/demo-session";
import { AuthService } from "../core/auth.service";
import { RoleService } from "../core/role.service";
import { MoodService } from "../core/mood.service";
import { JournalService } from "../core/journal.service";
import { WellnessService } from "../core/wellness.service";
import { CrisisPlanService, bundleIsEmpty } from "../core/crisis-plan.service";
import { FeedbackService } from "../core/feedback.service";
import { PageContainerComponent } from "../layout/page-container.component";

/** Personal data and owned clinician records. Therapy invitation tokens are never exported. */
const EXPORT_TABLES = [
  "mood_entries",
  "journal_entries",
  "sentiment_analyses",
  "reminders",
  "wellness_goals",
  "meditation_sessions",
  "exercise_logs",
  "crisis_plans",
  "crisis_warning_signs",
  "crisis_coping_strategies",
  "crisis_distractions",
  "crisis_support_contacts",
  "crisis_professional_contacts",
  "crisis_safety_steps",
  "crisis_reasons_for_living",
  "crisis_plan_shares",
  "clients",
  "soap_notes",
  "therapy_connections",
  "therapy_sessions",
  "pre_session_notes",
] as const;

@Component({
  selector: "app-profile",
  standalone: true,
  imports: [LucideAngularModule, ButtonModule, PageContainerComponent],
  template: `
    <app-page-container maxWidth="md">
      <header class="animate-fade-in-up">
        <h1 class="text-3xl">Profile</h1>
        <p class="mt-2 text-sm text-muted-foreground">Your account, your data — all of it yours.</p>
      </header>

      <section class="glass-card-elevated mt-6 animate-fade-in-up p-5" style="animation-delay: 60ms">
        <div class="flex items-center gap-4">
          <span
            class="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gradient-primary font-display text-xl text-primary-foreground shadow-glow"
          >
            {{ initials() }}
          </span>
          <div class="min-w-0 flex-1">
            <p class="truncate text-lg font-medium">{{ email() }}</p>
            <p class="text-xs text-muted-foreground">
              Member since {{ sinceLabel() }} ·
              <span class="capitalize">{{ role.role() ?? "client" }}</span>
            </p>
          </div>
        </div>
      </section>

      <section class="mt-4 animate-fade-in-up" style="animation-delay: 120ms" aria-label="Your data">
        <div class="glass-card p-5">
          <h2 class="text-lg">What SIGGY is holding for you</h2>
          <div class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            @for (stat of dataCounts(); track stat.label) {
              <div class="rounded-xl bg-muted/50 px-3 py-2.5">
                <p class="font-display text-xl leading-none">{{ stat.value }}</p>
                <p class="mt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {{ stat.label }}
                </p>
              </div>
            }
          </div>
        </div>
      </section>

      <section class="mt-4 animate-fade-in-up" style="animation-delay: 180ms" aria-label="Export">
        <div class="glass-card p-5">
          <div class="flex items-center gap-2">
            <lucide-icon [img]="Download" [size]="18" class="text-primary" />
            <h2 class="text-lg">Export my data</h2>
          </div>
          <p class="mt-2 text-sm text-muted-foreground">
            One JSON file with everything — check-ins, journals, sentiment, wellness, your
            crisis plan, and (if you're a clinician) clients and notes. Yours to keep, move,
            or hand to another tool.
          </p>
          <p-button
            label="Download JSON export"
            icon="pi pi-download"
            styleClass="w-full btn-glow mt-4"
            class="mt-4 block w-full"
            [loading]="exporting()"
            (onClick)="exportData()"
          />
        </div>
      </section>
    </app-page-container>
  `,
})
export class ProfileComponent {
  readonly Download = Download;

  private readonly auth = inject(AuthService);
  readonly role = inject(RoleService);
  private readonly mood = inject(MoodService);
  private readonly journal = inject(JournalService);
  private readonly wellness = inject(WellnessService);
  private readonly crisis = inject(CrisisPlanService);
  private readonly feedback = inject(FeedbackService);
  private readonly messages = inject(MessageService);

  readonly exporting = signal(false);

  readonly email = computed(() => this.auth.user()?.email ?? "");
  readonly initials = computed(() => this.email().slice(0, 2).toUpperCase() || "?");
  readonly sinceLabel = computed(() => {
    const createdAt = this.auth.user()?.created_at;
    return createdAt ? format(new Date(createdAt), "MMMM yyyy") : "—";
  });

  readonly dataCounts = computed(() => {
    const counts = [
      { label: "Check-ins", value: (this.mood.entriesQuery.data() ?? []).length },
      { label: "Journal entries", value: (this.journal.entriesQuery.data() ?? []).length },
      { label: "Goals", value: (this.wellness.goalsQuery.data() ?? []).length },
      { label: "Meditations", value: (this.wellness.sessionsQuery.data() ?? []).length },
      { label: "Movement logs", value: (this.wellness.exerciseQuery.data() ?? []).length },
      {
        label: "Crisis plan",
        value: this.crisis.planQuery.data() && !bundleIsEmpty(this.crisis.bundle()) ? "✓" : "—",
      },
    ];
    return counts;
  });

  async exportData() {
    const user = this.auth.user();
    if (!user || this.exporting()) return;
    this.exporting.set(true);
    try {
      const data: Record<string, unknown[]> = {};
      await Promise.all(
        EXPORT_TABLES.map(async (table) => {
          const allRows = new Map<string, unknown>();
          const ownerColumns = table === "therapy_connections" || table === "therapy_sessions"
            ? ["user_id", "therapist_id"]
            : [table === "clients" || table === "soap_notes" ? "therapist_id" : "user_id"];
          const rowKey = table === "pre_session_notes" ? "session_id" : "id";
          const pageSize = 500;
          for (const ownerColumn of ownerColumns) {
            for (let from = 0; ; from += pageSize) {
              if (this.auth.user()?.id !== user.id) throw new Error("Your account changed. Please start the export again.");
              const { data: rows, error } = await supabase.from(table).select("*")
                .eq(ownerColumn, user.id).order(rowKey).range(from, from + pageSize - 1);
              if (error) throw new Error(`Couldn't export ${table}. Please try again.`);
              for (const row of rows ?? []) allRows.set(String(row[rowKey]), row);
              if (!rows || rows.length < pageSize) break;
            }
          }
          data[table] = [...allRows.values()];
        })
      );

      if (this.auth.user()?.id !== user.id) throw new Error("Your account changed. Please start the export again.");

      const payload = {
        app: "Check-In with SIGGY",
        ...(isDemoMode() ? { demo: true, notice: "Fictional sample data from the interactive demo." } : {}),
        exported_at: new Date().toISOString(),
        user: { id: user.id, email: user.email },
        data,
      };

      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `siggy-${isDemoMode() ? "demo-" : ""}export-${format(new Date(), "yyyy-MM-dd")}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      this.feedback.trigger("success");
      this.messages.add({
        severity: "success",
        summary: "Export ready",
        detail: isDemoMode() ? "Your demo sample data is downloading as JSON." : "Your data is downloading as JSON.",
      });
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
}
