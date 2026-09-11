import { computed, inject, Injectable } from "@angular/core";
import {
  injectMutation,
  injectQuery,
  QueryClient,
} from "@tanstack/angular-query-experimental";
import { supabase } from "./supabase.client";
import { AuthService } from "./auth.service";
import { optionalText, requiredText, validDateKey } from "./data-validation";

export interface Client {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  created_at: string;
  updated_at: string;
}

export type NoteFormat = "SOAP" | "DAP" | "BIRP";

export interface SoapNote {
  id: string;
  client_id: string;
  format: NoteFormat;
  session_date: string;
  content: Record<string, string>;
  created_at: string;
  updated_at: string;
}

export interface NoteSection {
  key: string;
  label: string;
  hint: string;
}

/** Section templates. Content is stored as jsonb keyed by these section keys. */
export const NOTE_FORMATS: Record<NoteFormat, NoteSection[]> = {
  SOAP: [
    { key: "subjective", label: "Subjective", hint: "Client-reported experience, concerns, quotes" },
    { key: "objective", label: "Objective", hint: "Observable data — affect, appearance, engagement" },
    { key: "assessment", label: "Assessment", hint: "Clinical impression and progress toward goals" },
    { key: "plan", label: "Plan", hint: "Next steps, interventions, homework, follow-up" },
  ],
  DAP: [
    { key: "data", label: "Data", hint: "What happened in session — reported and observed" },
    { key: "assessment", label: "Assessment", hint: "Clinical impression and progress toward goals" },
    { key: "plan", label: "Plan", hint: "Next steps, interventions, homework, follow-up" },
  ],
  BIRP: [
    { key: "behavior", label: "Behavior", hint: "Client presentation and behavior in session" },
    { key: "intervention", label: "Intervention", hint: "What the clinician did and why" },
    { key: "response", label: "Response", hint: "How the client responded to the intervention" },
    { key: "plan", label: "Plan", hint: "Next steps, interventions, homework, follow-up" },
  ],
};

@Injectable({ providedIn: "root" })
export class ClientsService {
  private readonly auth = inject(AuthService);
  private readonly queryClient = inject(QueryClient);

  readonly clientsQuery = injectQuery(() => ({
    queryKey: ["clients", this.auth.user()?.id],
    enabled: !!this.auth.user(),
    queryFn: async ({ queryKey, signal }): Promise<Client[]> => {
      const ownerId = queryKey[queryKey.length - 1] as string;
      this.auth.assertUser(ownerId);
      const { data, error } = await supabase
        .from("clients")
        .select("id, name, email, phone, created_at, updated_at")
        .eq("therapist_id", ownerId)
        .abortSignal(signal)
        .order("name", { ascending: true });
      if (error) throw new Error(error.message);
      this.auth.assertUser(ownerId);
      return (data ?? []) as Client[];
    },
  }));

  readonly clientsById = computed(() => {
    const map = new Map<string, Client>();
    for (const client of this.clientsQuery.data() ?? []) {
      map.set(client.id, client);
    }
    return map;
  });

  readonly notesQuery = injectQuery(() => ({
    queryKey: ["soap-notes", this.auth.user()?.id],
    enabled: !!this.auth.user(),
    queryFn: async ({ queryKey, signal }): Promise<SoapNote[]> => {
      const ownerId = queryKey[queryKey.length - 1] as string;
      this.auth.assertUser(ownerId);
      const { data, error } = await supabase
        .from("soap_notes")
        .select("id, client_id, format, session_date, content, created_at, updated_at")
        .eq("therapist_id", ownerId)
        .abortSignal(signal)
        .order("session_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw new Error(error.message);
      this.auth.assertUser(ownerId);
      return (data ?? []) as SoapNote[];
    },
  }));

  readonly addClientMutation = injectMutation(() => ({
    mutationFn: async (payload: { name: string; email: string | null; phone: string | null }) => {
      const therapistId = this.auth.user()?.id;
      if (!therapistId) throw new Error("You need to be signed in.");
      const { error } = await supabase
        .from("clients")
        .insert({
          name: requiredText(payload.name, "Client name", 200),
          email: optionalText(payload.email, "Email", 320),
          phone: optionalText(payload.phone, "Phone", 80),
          therapist_id: therapistId,
        });
      if (error) throw new Error(error.message);
      this.auth.assertUser(therapistId);
    },
    onSuccess: () => this.invalidate("clients"),
  }));

  readonly deleteClientMutation = injectMutation(() => ({
    mutationFn: async (id: string) => {
      const therapistId = this.auth.requireUserId();
      const { error } = await supabase.from("clients").delete()
        .eq("id", id).eq("therapist_id", therapistId).select("id").single();
      if (error?.code === "23503") throw new Error("This client has therapy session history and cannot be deleted here. Manage or disconnect the relationship in Therapy sessions; saved notes are retained.");
      if (error) throw new Error(error.message);
      this.auth.assertUser(therapistId);
    },
    onSuccess: () => Promise.all([this.invalidate("clients"), this.invalidate("soap-notes"), this.queryClient.invalidateQueries({ queryKey: ["therapy"] })]),
  }));

  readonly addNoteMutation = injectMutation(() => ({
    mutationFn: async (payload: {
      client_id: string;
      format: NoteFormat;
      session_date: string;
      content: Record<string, string>;
    }) => {
      const therapistId = this.auth.user()?.id;
      if (!therapistId) throw new Error("You need to be signed in.");
      if (!Object.hasOwn(NOTE_FORMATS, payload.format)) throw new Error("Choose a valid note format.");
      if (!validDateKey(payload.session_date)) throw new Error("Choose a valid session date.");
      const content = Object.fromEntries(NOTE_FORMATS[payload.format].map(({ key, label }) =>
        [key, optionalText(payload.content?.[key], label, 20000) ?? ""]
      ));
      if (!Object.values(content).some(Boolean)) throw new Error("Add note content before saving.");
      const { error } = await supabase
        .from("soap_notes")
        .insert({ client_id: requiredText(payload.client_id, "Client", 100), format: payload.format,
          session_date: payload.session_date, content, therapist_id: therapistId });
      if (error) throw new Error(error.message);
      this.auth.assertUser(therapistId);
    },
    onSuccess: () => this.invalidate("soap-notes"),
  }));

  readonly deleteNoteMutation = injectMutation(() => ({
    mutationFn: async (id: string) => {
      const therapistId = this.auth.requireUserId();
      const { error } = await supabase.from("soap_notes").delete()
        .eq("id", id).eq("therapist_id", therapistId).select("id").single();
      if (error) throw new Error(error.message);
      this.auth.assertUser(therapistId);
    },
    onSuccess: () => this.invalidate("soap-notes"),
  }));

  private invalidate(key: string) {
    return this.queryClient.invalidateQueries({ queryKey: [key, this.auth.user()?.id] });
  }
}
