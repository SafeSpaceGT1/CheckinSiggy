import { Component, input } from "@angular/core";
import { LucideAngularModule, Phone } from "lucide-angular";
import { telHref, type PlanBundle } from "../core/crisis-plan.service";

/**
 * Read-only Stanley-Brown plan renderer. Used by /crisis-plan and the public
 * /shared-plan/:token page — one source of truth for how a plan looks.
 */
@Component({
  selector: "app-crisis-plan-view",
  standalone: true,
  imports: [LucideAngularModule],
  template: `
    <div class="space-y-4">
      @if (bundle().warningSigns.length > 0) {
        <section class="glass-card p-5">
          <div class="flex items-center gap-3">
            <span [class]="numberChip">1</span>
            <div>
              <h2 class="text-lg leading-tight">Warning signs</h2>
              <p class="text-xs text-muted-foreground">Signals that it's time to use this plan</p>
            </div>
          </div>
          <ul class="mt-3 space-y-2">
            @for (item of bundle().warningSigns; track $index) {
              <li class="flex gap-2 text-sm">
                <span class="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gradient-primary"></span>
                {{ item.text }}
              </li>
            }
          </ul>
        </section>
      }

      @if (bundle().copingStrategies.length > 0) {
        <section class="glass-card p-5">
          <div class="flex items-center gap-3">
            <span [class]="numberChip">2</span>
            <div>
              <h2 class="text-lg leading-tight">Things I can do myself</h2>
              <p class="text-xs text-muted-foreground">Internal coping strategies</p>
            </div>
          </div>
          <ul class="mt-3 space-y-2">
            @for (item of bundle().copingStrategies; track $index) {
              <li class="flex gap-2 text-sm">
                <span class="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gradient-primary"></span>
                {{ item.text }}
              </li>
            }
          </ul>
        </section>
      }

      @if (bundle().distractions.length > 0) {
        <section class="glass-card p-5">
          <div class="flex items-center gap-3">
            <span [class]="numberChip">3</span>
            <div>
              <h2 class="text-lg leading-tight">People & places for distraction</h2>
              <p class="text-xs text-muted-foreground">Company and settings that help</p>
            </div>
          </div>
          <div class="mt-3 space-y-2">
            @for (item of bundle().distractions; track $index) {
              <div class="flex items-center gap-3 rounded-xl bg-muted/50 px-3 py-2.5">
                <div class="min-w-0 flex-1">
                  <p class="text-sm font-medium">{{ item.name }}</p>
                  <p class="text-xs capitalize text-muted-foreground">{{ item.kind }}</p>
                </div>
                @if (item.phone) {
                  <a [href]="tel(item.phone)" [class]="callButton" [attr.aria-label]="'Call ' + item.name">
                    <lucide-icon [img]="Phone" [size]="16" />
                    Call
                  </a>
                }
              </div>
            }
          </div>
        </section>
      }

      @if (bundle().supportContacts.length > 0) {
        <section class="glass-card p-5">
          <div class="flex items-center gap-3">
            <span [class]="numberChip">4</span>
            <div>
              <h2 class="text-lg leading-tight">People I can ask for help</h2>
              <p class="text-xs text-muted-foreground">Family and friends who show up</p>
            </div>
          </div>
          <div class="mt-3 space-y-2">
            @for (item of bundle().supportContacts; track $index) {
              <div class="flex items-center gap-3 rounded-xl bg-muted/50 px-3 py-2.5">
                <div class="min-w-0 flex-1">
                  <p class="text-sm font-medium">{{ item.name }}</p>
                  @if (item.relationship) {
                    <p class="text-xs text-muted-foreground">{{ item.relationship }}</p>
                  }
                </div>
                @if (item.phone) {
                  <a [href]="tel(item.phone)" [class]="callButton" [attr.aria-label]="'Call ' + item.name">
                    <lucide-icon [img]="Phone" [size]="16" />
                    Call
                  </a>
                }
              </div>
            }
          </div>
        </section>
      }

      @if (bundle().professionalContacts.length > 0) {
        <section class="glass-card p-5">
          <div class="flex items-center gap-3">
            <span [class]="numberChip">5</span>
            <div>
              <h2 class="text-lg leading-tight">Professionals & agencies</h2>
              <p class="text-xs text-muted-foreground">Trained support, during a crisis</p>
            </div>
          </div>
          <div class="mt-3 space-y-2">
            @for (item of bundle().professionalContacts; track $index) {
              <div class="flex items-center gap-3 rounded-xl bg-muted/50 px-3 py-2.5">
                <div class="min-w-0 flex-1">
                  <p class="text-sm font-medium">{{ item.name }}</p>
                  @if (item.organization) {
                    <p class="text-xs text-muted-foreground">{{ item.organization }}</p>
                  }
                </div>
                @if (item.phone) {
                  <a [href]="tel(item.phone)" [class]="callButton" [attr.aria-label]="'Call ' + item.name">
                    <lucide-icon [img]="Phone" [size]="16" />
                    Call
                  </a>
                }
              </div>
            }
          </div>
        </section>
      }

      @if (bundle().safetySteps.length > 0) {
        <section class="glass-card p-5">
          <div class="flex items-center gap-3">
            <span [class]="numberChip">6</span>
            <div>
              <h2 class="text-lg leading-tight">Making my space safer</h2>
              <p class="text-xs text-muted-foreground">Small changes that lower the temperature</p>
            </div>
          </div>
          <ul class="mt-3 space-y-2">
            @for (item of bundle().safetySteps; track $index) {
              <li class="flex gap-2 text-sm">
                <span class="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gradient-primary"></span>
                {{ item.text }}
              </li>
            }
          </ul>
        </section>
      }

      @if (bundle().reasonsForLiving.length > 0) {
        <section class="card-highlight p-5">
          <h2 class="text-lg leading-tight gradient-text">Worth remembering</h2>
          <p class="text-xs text-muted-foreground">Your reasons, in your words</p>
          <ul class="mt-3 space-y-2">
            @for (item of bundle().reasonsForLiving; track $index) {
              <li class="flex gap-2 text-sm">
                <span class="mt-1.5 text-primary">♥</span>
                {{ item.text }}
              </li>
            }
          </ul>
        </section>
      }
    </div>
  `,
})
export class CrisisPlanViewComponent {
  readonly Phone = Phone;
  readonly bundle = input.required<PlanBundle>();

  readonly numberChip =
    "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-primary font-display text-lg text-primary-foreground shadow-glow";
  readonly callButton =
    "flex min-h-[44px] items-center gap-1.5 rounded-full bg-success/15 px-4 py-2 text-sm font-semibold text-success transition-transform hover:scale-105 active:scale-95";

  tel(phone: string): string {
    return telHref(phone);
  }
}
