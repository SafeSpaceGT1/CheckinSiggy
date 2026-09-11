import { signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { ActivatedRoute, convertToParamMap, Router } from "@angular/router";
import { MessageService } from "primeng/api";
import { AuthComponent } from "./auth.component";
import { AuthService } from "../core/auth.service";
import { FeedbackService } from "../core/feedback.service";
import { supabase } from "../core/supabase.client";

describe("Authentication flow", () => {
  let component: AuthComponent;
  let router: jasmine.SpyObj<Router>;
  let messages: jasmine.SpyObj<MessageService>;
  let route: { snapshot: { queryParamMap: ReturnType<typeof convertToParamMap> } };

  beforeEach(async () => {
    router = jasmine.createSpyObj("Router", ["navigate", "navigateByUrl"]);
    router.navigate.and.resolveTo(true);
    router.navigateByUrl.and.resolveTo(true);
    messages = jasmine.createSpyObj("MessageService", ["add"]);
    route = { snapshot: { queryParamMap: convertToParamMap({ returnUrl: "/journal" }) } };
    TestBed.configureTestingModule({ providers: [
      { provide: Router, useValue: router },
      { provide: ActivatedRoute, useValue: route },
      { provide: AuthService, useValue: { user: signal(null), ready: Promise.resolve() } },
      { provide: FeedbackService, useValue: { trigger: jasmine.createSpy("trigger") } },
      { provide: MessageService, useValue: messages },
    ] });
    component = TestBed.runInInjectionContext(() => new AuthComponent());
    Object.defineProperty(component, "configured", { value: true });
    component.signInForm.setValue({ email: "client@example.test", password: "password1" });
    component.signUpForm.setValue({ email: "client@example.test", password: "password1" });
    await Promise.resolve();
  });

  it("preserves a protected destination after sign-in", async () => {
    spyOn(supabase.auth, "signInWithPassword").and.resolveTo({ error: null } as never);
    await component.signIn();
    expect(router.navigateByUrl).toHaveBeenCalledOnceWith("/journal");
    expect(component.submitting()).toBeFalse();
  });

  it("rejects an external return destination", async () => {
    route.snapshot.queryParamMap = convertToParamMap({ returnUrl: "//external.example/path" });
    spyOn(supabase.auth, "signInWithPassword").and.resolveTo({ error: null } as never);
    await component.signIn();
    expect(router.navigateByUrl).toHaveBeenCalledOnceWith("/");
  });

  it("keeps an unconfirmed signup on sign-in with persistent instructions", async () => {
    spyOn(supabase.auth, "signUp").and.resolveTo({ data: { session: null }, error: null } as never);
    await component.signUp();
    expect(component.verificationMessage()).toContain("Check your email");
    expect(router.navigate).not.toHaveBeenCalled();
    expect(router.navigateByUrl).not.toHaveBeenCalled();
    expect(component.signUpForm.controls.password.value).toBe("");
  });

  it("sends an immediate-session signup to onboarding", async () => {
    spyOn(supabase.auth, "signUp").and.resolveTo({ data: { session: {} }, error: null } as never);
    await component.signUp();
    expect(router.navigate).toHaveBeenCalledOnceWith(["/onboarding"]);
  });

  it("unlocks the form when the network rejects", async () => {
    spyOn(supabase.auth, "signInWithPassword").and.rejectWith(new Error("Network offline"));
    await component.signIn();
    expect(component.submitting()).toBeFalse();
    expect(messages.add).toHaveBeenCalledWith(jasmine.objectContaining({ severity: "error", summary: "Sign in failed" }));
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it("ignores a second submission while sign-in is pending", async () => {
    let resolve!: (result: never) => void;
    const pending = new Promise<never>((done) => { resolve = done; });
    const signIn = spyOn(supabase.auth, "signInWithPassword").and.returnValue(pending);
    const first = component.signIn();
    await component.signIn();
    expect(signIn).toHaveBeenCalledTimes(1);
    resolve({ error: null } as never);
    await first;
  });
});
