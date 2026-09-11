import { signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { MessageService } from "primeng/api";
import { ProfileComponent } from "./profile.component";
import { AuthService } from "../core/auth.service";
import { FeedbackService } from "../core/feedback.service";
import { RoleService } from "../core/role.service";
import { MoodService } from "../core/mood.service";
import { JournalService } from "../core/journal.service";
import { WellnessService } from "../core/wellness.service";
import { CrisisPlanService } from "../core/crisis-plan.service";
import { supabase } from "../core/supabase.client";

describe("Account export integrity", () => {
  let component: ProfileComponent;
  let messages: jasmine.SpyObj<MessageService>;
  beforeEach(() => {
    messages = jasmine.createSpyObj("MessageService", ["add"]);
    TestBed.configureTestingModule({ providers: [
      { provide: AuthService, useValue: { user: signal({ id: "export-owner", email: "owner@example.test" }) } },
      { provide: FeedbackService, useValue: { trigger: jasmine.createSpy("trigger") } },
      { provide: MessageService, useValue: messages },
      ...[RoleService, MoodService, JournalService, WellnessService, CrisisPlanService].map(provide => ({ provide, useValue: {} })),
    ] });
    component = TestBed.runInInjectionContext(() => new ProfileComponent());
    spyOn(URL, "createObjectURL").and.returnValue("blob:synthetic-export");
    spyOn(URL, "revokeObjectURL");
    spyOn(HTMLAnchorElement.prototype, "click");
  });

  it("exports every page with an explicit owner filter", async () => {
    const query: Record<string, jasmine.Spy> = {};
    for (const name of ["select", "eq", "order"]) query[name] = jasmine.createSpy(name).and.returnValue(query);
    query["range"] = jasmine.createSpy("range").and.callFake((from: number) => Promise.resolve({
      data: from === 0 ? Array.from({ length: 500 }, (_, id) => ({ id })) : [{ id: 500 }], error: null,
    }));
    const owners: Record<string, string[]> = {};
    spyOn(supabase, "from").and.callFake((table: string) => {
      const tableQuery = { ...query };
      tableQuery["select"] = jasmine.createSpy("select").and.returnValue(tableQuery);
      tableQuery["eq"] = jasmine.createSpy("eq").and.callFake((column: string, owner: string) => {
        (owners[table] ??= []).push(column);
        expect(owner).toBe("export-owner");
        const expected = ["clients", "soap_notes"].includes(table) ? "therapist_id" : "user_id";
        if (column !== expected && !(["therapy_connections", "therapy_sessions"].includes(table) && column === "therapist_id")) throw new Error(`Unknown owner column ${table}.${column}`);
        return tableQuery;
      });
      tableQuery["order"] = jasmine.createSpy("order").and.returnValue(tableQuery);
      return tableQuery as never;
    });
    await component.exportData();
    expect(owners["mood_entries"]).toEqual(["user_id", "user_id"]);
    expect(owners["clients"]).toEqual(["therapist_id", "therapist_id"]);
    expect(owners["soap_notes"]).toEqual(["therapist_id", "therapist_id"]);
    expect(owners["therapy_sessions"]).toEqual(["user_id", "user_id", "therapist_id", "therapist_id"]);
    expect(owners["pre_session_notes"]).toEqual(["user_id", "user_id"]);
    expect(query["range"]).toHaveBeenCalledWith(500, 999);
    const blob = (URL.createObjectURL as jasmine.Spy).calls.mostRecent().args[0] as Blob;
    const payload = JSON.parse(await blob.text());
    expect(payload.data.mood_entries.length).toBe(501);
    expect(payload.data.soap_notes.length).toBe(501);
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
  });

  it("does not download or report success when a table cannot be read", async () => {
    const query: Record<string, jasmine.Spy> = {};
    for (const name of ["select", "eq", "order"]) query[name] = jasmine.createSpy(name).and.returnValue(query);
    query["range"] = jasmine.createSpy("range").and.resolveTo({ data: null, error: { message: "unavailable" } });
    spyOn(supabase, "from").and.returnValue(query as never);
    await component.exportData();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(messages.add).toHaveBeenCalledWith(jasmine.objectContaining({ severity: "error", summary: "Export failed" }));
    expect(component.exporting()).toBeFalse();
  });
});
