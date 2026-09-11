import { signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { ConfirmationService, MessageService } from "primeng/api";
import { FeedbackService } from "../core/feedback.service";
import { MEDITATIONS, WellnessService } from "../core/wellness.service";
import { ProgressComponent } from "./progress.component";

function mutation() {
  return { isPending: signal(false), mutate: jasmine.createSpy("mutate") };
}

describe("ProgressComponent", () => {
  let component: ProgressComponent;
  let wellness: {
    addGoalMutation: ReturnType<typeof mutation>;
    logExerciseMutation: ReturnType<typeof mutation>;
    logMeditationMutation: ReturnType<typeof mutation>;
    goalsQuery: { data: ReturnType<typeof signal<never[]>> };
    exerciseQuery: { data: ReturnType<typeof signal<never[]>> };
  };

  beforeEach(() => {
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date("2026-09-11T12:00:00Z"));
    wellness = {
      addGoalMutation: mutation(),
      logExerciseMutation: mutation(),
      logMeditationMutation: mutation(),
      goalsQuery: { data: signal([]) },
      exerciseQuery: { data: signal([]) },
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: WellnessService, useValue: wellness },
        { provide: FeedbackService, useValue: { trigger: jasmine.createSpy("trigger") } },
        { provide: MessageService, useValue: { add: jasmine.createSpy("add") } },
        { provide: ConfirmationService, useValue: { confirm: jasmine.createSpy("confirm") } },
      ],
    });
    component = TestBed.runInInjectionContext(() => new ProgressComponent());
  });

  afterEach(() => {
    component.ngOnDestroy();
    jasmine.clock().uninstall();
  });

  it("uses elapsed time after a background delay and caps completion at the session length", () => {
    component.startMeditation(MEDITATIONS[0]);
    jasmine.clock().mockDate(new Date("2026-09-11T12:02:00Z"));
    jasmine.clock().tick(250);
    expect(wellness.logMeditationMutation.mutate).toHaveBeenCalledTimes(1);
    expect(wellness.logMeditationMutation.mutate.calls.mostRecent().args[0].completedSeconds).toBe(60);
  });

  it("preserves partial seconds while excluding paused time", () => {
    component.startMeditation(MEDITATIONS[0]);
    jasmine.clock().tick(1750);
    component.toggleMeditation();
    jasmine.clock().tick(5000);
    component.toggleMeditation();
    jasmine.clock().tick(250);
    component.finishMeditation();
    expect(wellness.logMeditationMutation.mutate.calls.mostRecent().args[0].completedSeconds).toBe(2);
  });

  it("does not fabricate a completed second for an immediately finished session", () => {
    component.startMeditation(MEDITATIONS[0]);
    component.finishMeditation();
    expect(wellness.logMeditationMutation.mutate).not.toHaveBeenCalled();
  });

  it("prevents duplicate saves and retains a failed session for retry", () => {
    component.startMeditation(MEDITATIONS[0]);
    jasmine.clock().tick(3000);
    component.finishMeditation();
    component.finishMeditation();
    expect(wellness.logMeditationMutation.mutate).toHaveBeenCalledTimes(1);
    const callbacks = wellness.logMeditationMutation.mutate.calls.mostRecent().args[1];
    callbacks.onError(new Error("Offline"));
    callbacks.onSettled();
    expect(component.activeMeditation()).toEqual(MEDITATIONS[0]);
    expect(component.running()).toBeFalse();
    component.finishMeditation();
    expect(wellness.logMeditationMutation.mutate).toHaveBeenCalledTimes(2);
    expect(wellness.logMeditationMutation.mutate.calls.mostRecent().args[0].completedSeconds).toBe(3);
  });

  it("validates exercise inputs and rejects repeated clicks while saving", () => {
    component.exMinutes.set(NaN);
    component.logExercise();
    expect(wellness.logExerciseMutation.mutate).not.toHaveBeenCalled();
    component.exMinutes.set(30);
    component.exActivity.set("Other");
    component.exCustom.set("  ");
    component.logExercise();
    expect(wellness.logExerciseMutation.mutate).not.toHaveBeenCalled();
    component.exCustom.set("Dancing");
    component.logExercise();
    component.logExercise();
    expect(wellness.logExerciseMutation.mutate).toHaveBeenCalledTimes(1);
  });

  it("rejects blank goals and duplicate submissions", () => {
    component.goalTitle.set("  ");
    component.addGoal();
    expect(wellness.addGoalMutation.mutate).not.toHaveBeenCalled();
    component.goalTitle.set("Take a walk");
    component.addGoal();
    component.addGoal();
    expect(wellness.addGoalMutation.mutate).toHaveBeenCalledTimes(1);
  });
});
