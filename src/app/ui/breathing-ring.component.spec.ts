import { BreathingRingComponent } from "./breathing-ring.component";

describe("BreathingRingComponent", () => {
  let component: BreathingRingComponent;

  beforeEach(() => {
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date("2026-09-11T12:00:00Z"));
    component = new BreathingRingComponent();
    component.ngOnInit();
  });

  afterEach(() => {
    component.ngOnDestroy();
    jasmine.clock().uninstall();
  });

  it("advances through a complete 4-7-8 cycle", () => {
    jasmine.clock().tick(4000);
    expect(component.phase().label).toBe("Hold");
    expect(component.countdown()).toBe(7);
    jasmine.clock().tick(7000);
    expect(component.phase().label).toBe("Breathe out");
    expect(component.countdown()).toBe(8);
    jasmine.clock().tick(8000);
    expect(component.phase().label).toBe("Breathe in");
    expect(component.cycle()).toBe(2);
  });

  it("catches up to the correct phase after callbacks were delayed", () => {
    jasmine.clock().mockDate(new Date("2026-09-11T12:00:23Z"));
    jasmine.clock().tick(250);
    expect(component.cycle()).toBe(2);
    expect(component.phase().label).toBe("Hold");
    expect(component.countdown()).toBe(7);
  });
});
