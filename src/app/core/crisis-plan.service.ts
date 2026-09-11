import { computed, inject, Injectable } from "@angular/core";
import {
  injectMutation,
  injectQuery,
  QueryClient,
} from "@tanstack/angular-query-experimental";
import { supabase } from "./supabase.client";
import { AuthService } from "./auth.service";
import { integerInRange, optionalText, requiredText } from "./data-validation";

export interface CrisisPlan {
  id: string;
  created_at: string;
  updated_at: string;
}

export interface TextItem {
  id?: string;
  text: string;
}

export interface DistractionItem {
  id?: string;
  name: string;
  phone: string | null;
  kind: "person" | "place";
}

export interface SupportContact {
  id?: string;
  name: string;
  phone: string | null;
  relationship: string | null;
}

export interface ProfessionalContact {
  id?: string;
  name: string;
  organization: string | null;
  phone: string | null;
}

/** Everything a renderer needs — built from live queries or a shared token. */
export interface PlanBundle {
  warningSigns: TextItem[];
  copingStrategies: TextItem[];
  distractions: DistractionItem[];
  supportContacts: SupportContact[];
  professionalContacts: ProfessionalContact[];
  safetySteps: TextItem[];
  reasonsForLiving: TextItem[];
}

export interface PlanShare {
  id: string;
  token: string;
  expires_at: string | null;
  revoked: boolean;
  created_at: string;
}

export const EMERGENCY_DISCLAIMER =
  "This plan is not a substitute for emergency services. Call 911 (US) / 999 (UK) or your local emergency number if you're in immediate danger.";

export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

export function emptyBundle(): PlanBundle {
  return {
    warningSigns: [],
    copingStrategies: [],
    distractions: [],
    supportContacts: [],
    professionalContacts: [],
    safetySteps: [],
    reasonsForLiving: [],
  };
}

export function bundleIsEmpty(bundle: PlanBundle): boolean {
  return (
    bundle.warningSigns.length === 0 &&
    bundle.copingStrategies.length === 0 &&
    bundle.distractions.length === 0 &&
    bundle.supportContacts.length === 0 &&
    bundle.professionalContacts.length === 0 &&
    bundle.safetySteps.length === 0 &&
    bundle.reasonsForLiving.length === 0
  );
}

type ChildTable =
  | "crisis_warning_signs"
  | "crisis_coping_strategies"
  | "crisis_distractions"
  | "crisis_support_contacts"
  | "crisis_professional_contacts"
  | "crisis_safety_steps"
  | "crisis_reasons_for_living";

const CHILD_COLUMNS: Record<ChildTable, string> = {
  crisis_warning_signs: "id, text, position",
  crisis_coping_strategies: "id, text, position",
  crisis_distractions: "id, name, phone, kind, position",
  crisis_support_contacts: "id, name, phone, relationship, position",
  crisis_professional_contacts: "id, name, organization, phone, position",
  crisis_safety_steps: "id, text, position",
  crisis_reasons_for_living: "id, text, position",
};

function tokenString(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

@Injectable({ providedIn: "root" })
export class CrisisPlanService {
  private readonly auth = inject(AuthService);
  private readonly queryClient = inject(QueryClient);

  readonly planQuery = injectQuery(() => ({
    queryKey: ["crisis-plan", this.auth.user()?.id],
    enabled: !!this.auth.user(),
    queryFn: async ({ queryKey, signal }): Promise<CrisisPlan | null> => {
      const ownerId = queryKey[queryKey.length - 1] as string;
      this.auth.assertUser(ownerId);
      const { data, error } = await supabase
        .from("crisis_plans")
        .select("id, created_at, updated_at")
        .eq("user_id", ownerId)
        .abortSignal(signal)
        .maybeSingle();
      if (error) throw new Error(error.message);
      this.auth.assertUser(ownerId);
      return (data as CrisisPlan) ?? null;
    },
  }));

  private childQuery<T>(table: ChildTable) {
    return injectQuery(() => ({
      queryKey: ["crisis", table, this.auth.user()?.id],
      enabled: !!this.auth.user(),
      queryFn: async ({ queryKey, signal }): Promise<T[]> => {
        const ownerId = queryKey[queryKey.length - 1] as string;
        this.auth.assertUser(ownerId);
        const { data, error } = await supabase
          .from(table)
          .select(CHILD_COLUMNS[table])
          .eq("user_id", ownerId)
          .abortSignal(signal)
          .order("position", { ascending: true })
          .order("created_at", { ascending: true });
        if (error) throw new Error(error.message);
        this.auth.assertUser(ownerId);
        return (data ?? []) as T[];
      },
    }));
  }

  readonly warningSignsQuery = this.childQuery<TextItem>("crisis_warning_signs");
  readonly copingStrategiesQuery = this.childQuery<TextItem>("crisis_coping_strategies");
  readonly distractionsQuery = this.childQuery<DistractionItem>("crisis_distractions");
  readonly supportContactsQuery = this.childQuery<SupportContact>("crisis_support_contacts");
  readonly professionalContactsQuery = this.childQuery<ProfessionalContact>(
    "crisis_professional_contacts"
  );
  readonly safetyStepsQuery = this.childQuery<TextItem>("crisis_safety_steps");
  readonly reasonsQuery = this.childQuery<TextItem>("crisis_reasons_for_living");

  readonly bundle = computed<PlanBundle>(() => ({
    warningSigns: this.warningSignsQuery.data() ?? [],
    copingStrategies: this.copingStrategiesQuery.data() ?? [],
    distractions: this.distractionsQuery.data() ?? [],
    supportContacts: this.supportContactsQuery.data() ?? [],
    professionalContacts: this.professionalContactsQuery.data() ?? [],
    safetySteps: this.safetyStepsQuery.data() ?? [],
    reasonsForLiving: this.reasonsQuery.data() ?? [],
  }));

  private readonly planReads = [this.planQuery, this.warningSignsQuery, this.copingStrategiesQuery,
    this.distractionsQuery, this.supportContactsQuery, this.professionalContactsQuery,
    this.safetyStepsQuery, this.reasonsQuery];
  readonly loading = computed(() => this.planReads.some((query) => query.status() === "pending"));
  readonly loadError = computed(() => this.planReads.some((query) => query.status() === "error"));

  readonly createPlanMutation = injectMutation(() => ({
    mutationFn: async (): Promise<CrisisPlan> => {
      const userId = this.auth.user()?.id;
      if (!userId) throw new Error("You need to be signed in.");
      const { data, error } = await supabase
        .from("crisis_plans")
        .upsert({ user_id: userId }, { onConflict: "user_id" })
        .select("id, created_at, updated_at")
        .single();
      if (error) throw new Error(error.message);
      this.auth.assertUser(userId);
      return data as CrisisPlan;
    },
    onSuccess: () => this.invalidate(["crisis-plan"]),
  }));

  readonly addItemMutation = injectMutation(() => ({
    mutationFn: async (payload: {
      table: ChildTable;
      values: Record<string, unknown>;
      position: number;
    }) => {
      const userId = this.auth.user()?.id;
      const plan = this.planQuery.data();
      if (!userId || !plan) throw new Error("Start your plan first.");
      if (!Object.hasOwn(CHILD_COLUMNS, payload.table)) throw new Error("Invalid plan section.");
      const values: Record<string, unknown> = {};
      const allowed = CHILD_COLUMNS[payload.table].split(", ").filter((column) => column !== "id" && column !== "position");
      for (const field of allowed) {
        if (field === "text" || field === "name") values[field] = requiredText(payload.values[field], "Plan item", 5000);
        else if (field === "kind") {
          if (payload.values[field] !== "person" && payload.values[field] !== "place") throw new Error("Choose person or place.");
          values[field] = payload.values[field];
        } else values[field] = optionalText(payload.values[field], field, 500);
      }
      const { error } = await supabase.from(payload.table).insert({
        ...values,
        user_id: userId,
        plan_id: plan.id,
        position: integerInRange(payload.position, 0, 10000, "Position"),
      });
      if (error) throw new Error(error.message);
      this.auth.assertUser(userId);
    },
    onSuccess: (_data, variables) => this.invalidate(["crisis", variables.table]),
  }));

  readonly deleteItemMutation = injectMutation(() => ({
    mutationFn: async (payload: { table: ChildTable; id: string }) => {
      const userId = this.auth.requireUserId();
      if (!Object.hasOwn(CHILD_COLUMNS, payload.table)) throw new Error("Invalid plan section.");
      const { error } = await supabase.from(payload.table).delete()
        .eq("id", payload.id).eq("user_id", userId).select("id").single();
      if (error) throw new Error(error.message);
      this.auth.assertUser(userId);
    },
    onSuccess: (_data, variables) => this.invalidate(["crisis", variables.table]),
  }));

  // ----- Shares ---------------------------------------------------------------

  readonly sharesQuery = injectQuery(() => ({
    queryKey: ["crisis-shares", this.auth.user()?.id],
    enabled: !!this.auth.user(),
    queryFn: async ({ queryKey, signal }): Promise<PlanShare[]> => {
      const ownerId = queryKey[queryKey.length - 1] as string;
      this.auth.assertUser(ownerId);
      const { data, error } = await supabase
        .from("crisis_plan_shares")
        .select("id, token, expires_at, revoked, created_at")
        .eq("user_id", ownerId)
        .abortSignal(signal)
        .eq("revoked", false)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      this.auth.assertUser(ownerId);
      return (data ?? []) as PlanShare[];
    },
  }));

  readonly createShareMutation = injectMutation(() => ({
    mutationFn: async (expiryDays: number | null): Promise<string> => {
      const userId = this.auth.user()?.id;
      const plan = this.planQuery.data();
      if (!userId || !plan) throw new Error("Start your plan first.");
      if (expiryDays !== null) integerInRange(expiryDays, 1, 365, "Share duration");
      const token = tokenString();
      const expires_at = expiryDays
        ? new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000).toISOString()
        : null;
      const { error } = await supabase.from("crisis_plan_shares").insert({
        user_id: userId,
        plan_id: plan.id,
        token,
        expires_at,
      });
      if (error) throw new Error(error.message);
      this.auth.assertUser(userId);
      return token;
    },
    onSuccess: () => this.invalidate(["crisis-shares"]),
  }));

  readonly revokeShareMutation = injectMutation(() => ({
    mutationFn: async (id: string) => {
      const userId = this.auth.requireUserId();
      const { error } = await supabase
        .from("crisis_plan_shares")
        .update({ revoked: true })
        .eq("id", id).eq("user_id", userId).select("id").single();
      if (error) throw new Error(error.message);
      this.auth.assertUser(userId);
    },
    onSuccess: () => this.invalidate(["crisis-shares"]),
  }));

  private invalidate(key: unknown[]) {
    return this.queryClient.invalidateQueries({ queryKey: [...key, this.auth.user()?.id] });
  }
}
