import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export interface TimelineStep {
  label: string;
  /** When it happened; null for steps still to come. */
  at: string | null;
  /** A second line, e.g. who scanned it. */
  detail?: string;
  state: 'done' | 'current' | 'upcoming' | 'undone';
}

/**
 * A parcel's steps, one under the other. Local until the toolkit has one (finding 83666cb3
 * against design): swap it for os-timeline then.
 */
@Component({
  selector: 'app-timeline',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ol class="timeline" [attr.aria-label]="label()">
      @for (step of steps(); track $index) {
        <li [class]="step.state" [attr.aria-current]="step.state === 'current' ? 'step' : null">
          <span class="dot" aria-hidden="true"></span>
          <span class="text">
            <span class="label">
              {{ step.label }}
              @if (step.state === 'undone') {
                <span class="os-visually-hidden">(undone)</span>
              }
            </span>
            @if (step.at) {
              <time class="at" [attr.datetime]="step.at">{{ format(step.at) }}</time>
            }
            @if (step.detail) {
              <span class="detail">{{ step.detail }}</span>
            }
          </span>
        </li>
      }
    </ol>
  `,
  styles: `
    .timeline {
      display: grid;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    li {
      position: relative;
      display: grid;
      grid-template-columns: 1.25rem 1fr;
      gap: var(--os-space-3);
      padding-block-end: var(--os-space-4);
    }

    li:not(:last-child)::before {
      position: absolute;
      inset-block: 1.1rem 0;
      inset-inline-start: calc(0.625rem - 1px);
      inline-size: 2px;
      background: var(--os-border-default);
      content: '';
    }

    li.done:not(:last-child)::before {
      background: var(--os-brand-default);
    }

    .dot {
      box-sizing: border-box;
      inline-size: 1.25rem;
      block-size: 1.25rem;
      border: 2px var(--os-border-style) var(--os-border-strong);
      border-radius: 50%;
      background: var(--os-bg-default);
    }

    .done .dot {
      border-color: var(--os-brand-default);
      background: var(--os-brand-default);
    }

    .current .dot {
      border-color: var(--os-brand-default);
      box-shadow: 0 0 0 4px var(--os-brand-soft);
    }

    .text {
      display: grid;
      gap: var(--os-space-1);
      min-inline-size: 0;
    }

    .label {
      font-weight: var(--os-font-weight-medium);
    }

    .upcoming .label {
      color: var(--os-fg-muted);
      font-weight: var(--os-font-weight-regular);
    }

    .undone .label {
      color: var(--os-fg-muted);
      text-decoration: line-through;
    }

    .at,
    .detail {
      color: var(--os-fg-muted);
      font-size: var(--os-text-sm);
      font-variant-numeric: tabular-nums;
    }
  `,
})
export class Timeline {
  readonly steps = input.required<readonly TimelineStep[]>();
  readonly label = input('Journey');

  protected format(iso: string): string {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }
}
