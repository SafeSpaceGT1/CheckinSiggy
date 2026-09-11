import { Component, computed, input } from "@angular/core";

type MaxWidth = "sm" | "md" | "lg" | "xl";

const WIDTHS: Record<MaxWidth, string> = {
  sm: "max-w-md",
  md: "max-w-2xl",
  lg: "max-w-3xl",
  xl: "max-w-5xl",
};

/**
 * Page wrapper: padded, centered, with enough bottom clearance on mobile for
 * the tab bar plus both floating buttons, and top clearance on desktop for
 * the fixed navigation bar.
 */
@Component({
  selector: "app-page-container",
  standalone: true,
  template: `<main [class]="classes()"><ng-content /></main>`,
})
export class PageContainerComponent {
  readonly maxWidth = input<MaxWidth>("lg");
  readonly classes = computed(
    () => `mx-auto w-full px-4 pb-44 pt-6 md:px-6 md:pb-16 md:pt-24 ${WIDTHS[this.maxWidth()]}`
  );
}
