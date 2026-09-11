import { computed, inject, Injectable, signal } from "@angular/core";
import { AuthService } from "./auth.service";

export type UserRole = "client" | "clinician" | null;

function readStoredRole(userId: string): UserRole {
  try {
    const raw = localStorage.getItem(`siggy:role:${userId}`);
    return raw === "client" || raw === "clinician" ? raw : null;
  } catch {
    return null;
  }
}

/** Display preference only. Server authorization must never rely on this role. */
@Injectable({ providedIn: "root" })
export class RoleService {
  private readonly auth = inject(AuthService);
  private readonly selected = signal<Record<string, Exclude<UserRole, null>>>({});
  readonly role = computed<UserRole>(() => {
    const id = this.auth.user()?.id;
    return id ? this.selected()[id] ?? readStoredRole(id) : null;
  });
  readonly isClinician = computed(() => this.role() === "clinician");

  setRole(role: Exclude<UserRole, null>) {
    const id = this.auth.requireUserId();
    if (role !== "client" && role !== "clinician") throw new Error("Choose a valid role.");
    try {
      localStorage.setItem(`siggy:role:${id}`, role);
      localStorage.removeItem("userRole");
    } catch {
      // Keep the choice in memory when device storage is unavailable.
    }
    this.selected.update((current) => ({ ...current, [id]: role }));
  }
}
