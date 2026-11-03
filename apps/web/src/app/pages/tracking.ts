import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { STATUSES, type ParcelStatus, type Tracking as TrackingData } from '@open-relay/contracts';
import { Callout, Skeleton } from '@openstuff-dev/ui-angular';
import QRCode from 'qrcode';
import { Api, errorText } from '../core/api';
import { STATUS_LABELS, WEEKDAYS, code, longDay } from '../shared/labels';
import { Timeline, type TimelineStep } from '../shared/timeline';

const PATH: ParcelStatus[] = STATUSES.filter((s) => s !== 'cancelled');

const HEADLINE: Record<ParcelStatus, string> = {
  registered: 'Your parcel is being packed',
  ready: 'Your parcel is packed',
  in_transit: 'Your parcel is on its way',
  at_point: 'Your parcel is ready to collect',
  collected: 'You collected your parcel',
  cancelled: 'This delivery was cancelled',
};

/** The customer's page for one parcel, from the link in their emails. No account needed. */
@Component({
  selector: 'app-tracking',
  imports: [Callout, Skeleton, Timeline],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="page">
      @if (error(); as error) {
        <os-callout tone="danger" title="This parcel wasn’t found">
          {{ error }} Check that you opened the whole link from the email.
        </os-callout>
      }
      @if (data(); as t) {
        <p class="from">{{ t.merchant }}{{ t.reference ? ' · Order ' + t.reference : '' }}</p>
        <h1>{{ headline()[t.status] }}</h1>

        @if (t.pickupCode) {
          <section class="pickup" aria-labelledby="pickup">
            <h2 id="pickup">Show this at the counter</h2>
            @if (qr(); as qr) {
              <div class="qr" [innerHTML]="qr" role="img" aria-label="Pickup QR code"></div>
            }
            <p class="pin code" aria-label="Pickup code">{{ t.pickupCode }}</p>
            @if (t.holdUntil) {
              <p>
                Collect it by <strong>{{ day(t.holdUntil) }}</strong
                >.
              </p>
            }
          </section>
        }

        <section class="where" aria-labelledby="where">
          <h2 id="where">{{ t.status === 'collected' ? 'Collected at' : 'Pick-up point' }}</h2>
          <p>
            <strong>{{ t.point.name }}</strong
            ><br />
            {{ t.point.street }}<br />{{ t.point.postcode }} {{ t.point.city }}
          </p>
          <details>
            <summary>Opening hours</summary>
            <dl class="hours">
              @for (h of t.point.openingHours; track $index) {
                <dt>{{ weekdays[$index] }}</dt>
                <dd>{{ h || '—' }}</dd>
              }
            </dl>
          </details>
        </section>

        <section aria-labelledby="journey">
          <h2 id="journey">Journey</h2>
          <app-timeline [steps]="steps()" />
        </section>

        <p class="muted small">
          Parcel <span class="code">{{ fmt(t.code) }}</span>
        </p>
      } @else if (!error()) {
        <os-skeleton [lines]="6" />
      }
    </main>
  `,
  styles: `
    :host {
      display: block;
      min-block-size: 100dvh;
      background: var(--os-bg-alternative);
    }

    .page {
      display: grid;
      gap: var(--os-space-6);
      inline-size: min(32rem, 100%);
      margin-inline: auto;
      padding: var(--os-space-8) var(--os-space-4);
      box-sizing: border-box;
    }

    h1 {
      margin: 0;
      font-size: var(--os-text-2xl);
      line-height: var(--os-leading-tight);
      text-wrap: balance;
    }

    h2 {
      margin: 0 0 var(--os-space-3);
      font-size: var(--os-text-md);
    }

    p {
      margin: 0;
    }

    .from,
    .muted {
      color: var(--os-fg-muted);
    }

    .small {
      font-size: var(--os-text-sm);
    }

    .pickup,
    .where {
      padding: var(--os-space-5);
      border: 1px var(--os-border-style) var(--os-border-default);
      border-radius: var(--os-radius-lg);
      background: var(--os-bg-default);
    }

    .pickup {
      display: grid;
      gap: var(--os-space-3);
      justify-items: center;
      text-align: center;
      border-color: var(--os-brand-border);
    }

    .qr {
      inline-size: min(14rem, 70%);
      overflow: hidden;
      border-radius: var(--os-radius-md);
    }

    /* The code draws its own white background, so it scans in dark mode too. */
    .qr :is(svg) {
      display: block;
      inline-size: 100%;
      block-size: auto;
    }

    .pin {
      font-size: 2.5rem;
      font-weight: var(--os-font-weight-semibold);
      letter-spacing: 0.2em;
    }

    details {
      margin-block-start: var(--os-space-3);
    }

    summary {
      cursor: pointer;
      min-block-size: 2.75rem;
      display: flex;
      align-items: center;
    }

    .hours {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: var(--os-space-1) var(--os-space-4);
      margin: 0;
    }

    dd {
      margin: 0;
      font-variant-numeric: tabular-nums;
    }
  `,
})
export class Tracking {
  readonly token = input.required<string>();
  private readonly api = inject(Api);
  private readonly sanitizer = inject(DomSanitizer);
  protected readonly data = signal<TrackingData | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly qr = signal<SafeHtml | null>(null);
  protected readonly weekdays = WEEKDAYS;
  protected readonly fmt = code;
  protected readonly day = longDay;
  protected readonly headline = () => HEADLINE;

  protected readonly steps = computed<TimelineStep[]>(() => {
    const t = this.data();
    if (!t) return [];
    const done = t.steps.map((s, i): TimelineStep => ({
      label: STATUS_LABELS[s.status],
      at: s.at,
      state: i === t.steps.length - 1 && t.status !== 'collected' ? 'current' : 'done',
    }));
    const next = t.status === 'cancelled' ? [] : PATH.slice(PATH.indexOf(t.status) + 1);
    return [...done, ...next.map((s): TimelineStep => ({ label: STATUS_LABELS[s], at: null, state: 'upcoming' }))];
  });

  constructor() {
    effect(() => {
      void this.load(this.token());
    });
  }

  private async load(token: string): Promise<void> {
    try {
      const data = await this.api.get<TrackingData>(`/api/track/${encodeURIComponent(token)}`);
      this.data.set(data);
      if (data.pickupCode) {
        const svg = await QRCode.toString(data.pickupCode, { type: 'svg', margin: 2 });
        // A QR code we just drew from six digits: no markup from anyone else.
        // eslint-disable-next-line no-restricted-syntax -- see above.
        this.qr.set(this.sanitizer.bypassSecurityTrustHtml(svg));
      }
    } catch (error) {
      this.error.set(errorText(error));
    }
  }
}
