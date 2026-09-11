import { Component, input, output } from "@angular/core";

@Component({
  selector: "app-query-error",
  standalone: true,
  template: `
    <div role="alert" class="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
      <p class="font-medium">{{ message() }}</p>
      <p class="mt-1 text-muted-foreground">Your saved data may be unavailable right now. Check your connection and try again.</p>
      <button type="button" class="mt-3 min-h-[44px] rounded-lg px-3 font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" (click)="retry.emit()">Try again</button>
    </div>
  `,
})
export class QueryErrorComponent {
  readonly message = input("Couldn't load your data");
  readonly retry = output<void>();
}
