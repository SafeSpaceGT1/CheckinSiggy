import { signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { AuthService } from "./auth.service";
import { RoleService } from "./role.service";

describe("RoleService account isolation", () => {
  afterEach(() => { TestBed.resetTestingModule(); localStorage.removeItem("siggy:role:role-test-a"); localStorage.removeItem("siggy:role:role-test-b"); localStorage.removeItem("userRole"); });
  it("never carries a clinician preference into a different account or signed-out screen", () => {
    const user = signal<{ id: string } | null>({ id: "role-test-a" });
    TestBed.configureTestingModule({ providers: [{ provide: AuthService, useValue: {
      user, requireUserId: () => { if (!user()) throw new Error("Signed out"); return user()!.id; },
    } }] });
    localStorage.setItem("userRole", "clinician");
    const service = TestBed.inject(RoleService);
    expect(service.role()).toBeNull();
    service.setRole("clinician");
    expect(service.isClinician()).toBeTrue();
    user.set({ id: "role-test-b" });
    expect(service.role()).toBeNull();
    service.setRole("client");
    user.set({ id: "role-test-a" });
    expect(service.role()).toBe("clinician");
    user.set(null);
    expect(service.role()).toBeNull();
    expect(() => service.setRole("clinician")).toThrow();
  });
});
