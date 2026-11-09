import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { canCancel, type Parcel, type ParcelStatus, STATUSES } from '@open-relay/contracts';
import {
  Badge,
  Button,
  Callout,
  ConfirmDialog,
  Icon,
  PageHeader,
  Skeleton,
  slowLoading,
  Toaster,
} from '@openstuff-dev/ui-angular';
import { Api, errorText } from '../core/api';
import { Session } from '../core/session';
import { CopyButton } from '../shared/copy-button';
import { iconPrint } from '../shared/icons';
import { ROLE_LABELS, STATUS_LABELS, STATUS_TONES, code, longDay } from '../shared/labels';
import { Timeline, type TimelineStep } from '../shared/timeline';

/** The main path, for showing the steps still to come. */
const PATH: ParcelStatus[] = STATUSES.filter((s) => s !== 'cancelled');

/** One parcel: where it is, who has it, and everything that happened to it. */
@Component({
  selector: 'app-parcel',
  imports: [RouterLink, Badge, Button, Callout, CopyButton, Icon, PageHeader, Skeleton, Timeline],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'stack' },
  template: `
    <nav><a [routerLink]="['/n', network(), 'parcels']">← Parcels</a></nav>
    @if (error(); as error) {
      <os-callout tone="danger" title="The parcel didn’t load">{{ error }}</os-callout>
    }
    @if (parcel(); as p) {
      <header
        os-page-header
        [title]="'Parcel ' + fmt(p.code)"
        [description]="p.merchant.name + ' → ' + p.point.name"
      >
        @if (session.isShop()) {
          <a os-button target="_blank" rel="noopener" [href]="labelUrl()">
            <svg os-icon [icon]="iconPrint" size="sm"></svg>Print label
          </a>
          @if (cancellable()) {
            <button os-button type="button" tone="danger" variant="ghost" (click)="cancel()">
              Cancel parcel
            </button>
          }
        }
      </header>

      <div class="columns">
        <section class="stack" aria-labelledby="journey">
          <h2 id="journey">
            Journey
            <span os-badge [tone]="p.overdue ? 'danger' : tones[p.status]">{{
              p.overdue ? 'Overdue' : labels[p.status]
            }}</span>
          </h2>
          @if (p.status === 'at_point' && p.holdUntil) {
            <p class="muted">Waiting for the customer until {{ day(p.holdUntil) }}.</p>
          }
          <app-timeline [steps]="steps()" />
        </section>

        <section class="stack" aria-labelledby="customer">
          <h2 id="customer">Customer</h2>
          @if (p.customer; as c) {
            <dl class="facts">
              <dt>Name</dt>
              <dd>{{ c.name }}</dd>
              <dt>Email</dt>
              <dd>{{ c.email }}</dd>
              @if (c.phone) {
                <dt>Phone</dt>
                <dd>{{ c.phone }}</dd>
              }
              @if (c.street || c.city) {
                <dt>Address</dt>
                <dd>{{ c.street }}<br />{{ c.postcode }} {{ c.city }}</dd>
              }
              @if (p.reference) {
                <dt>Order</dt>
                <dd>{{ p.reference }}</dd>
              }
            </dl>
          } @else if (session.role() === 'courier') {
            <p class="muted">Couriers don’t see the customer’s details.</p>
          } @else {
            <p class="muted">The customer’s details were deleted after the retention period.</p>
          }
          @if (p.trackingUrl; as url) {
            <h3>Tracking link</h3>
            <p class="link">
              <a [href]="url" target="_blank" rel="noopener">{{ url }}</a>
              <app-copy-button [text]="url" what="tracking link" />
            </p>
            <p class="muted">
              The customer got it by email. It shows their pickup code once the parcel is at the
              point.
            </p>
          }
        </section>
      </div>
    } @else if (loading.slow()) {
      <os-skeleton [lines]="8" />
    }
  `,
  styles: `
    :host {
      container-type: inline-size;
    }

    .columns {
      display: grid;
      gap: var(--os-space-8);
    }

    @container (inline-size > 48rem) {
      .columns {
        grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
      }
    }

    h2 {
      display: flex;
      gap: var(--os-space-2);
      align-items: center;
      margin: 0;
      font-size: var(--os-text-lg);
    }

    h3 {
      margin: 0;
      font-size: var(--os-text-md);
    }

    p {
      margin: 0;
    }

    .facts {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: var(--os-space-2) var(--os-space-4);
      margin: 0;
    }

    dt {
      color: var(--os-fg-muted);
    }

    dd {
      margin: 0;
      overflow-wrap: anywhere;
    }

    .link {
      display: flex;
      gap: var(--os-space-2);
      align-items: center;
      overflow-wrap: anywhere;
    }
  `,
})
export class ParcelPage {
  readonly network = input.required<string>();
  readonly id = input.required<string>();
  protected readonly session = inject(Session);
  private readonly api = inject(Api);
  private readonly confirm = inject(ConfirmDialog);
  private readonly toaster = inject(Toaster);
  protected readonly parcel = signal<Parcel | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly loading = slowLoading();
  protected readonly labels = STATUS_LABELS;
  protected readonly tones = STATUS_TONES;
  protected readonly iconPrint = iconPrint;
  protected readonly fmt = code;
  protected readonly day = longDay;

  protected readonly cancellable = computed(() => {
    const p = this.parcel();
    return p ? canCancel(p.status) : false;
  });

  protected readonly labelUrl = computed(
    () => `/api/n/${encodeURIComponent(this.network())}/labels?ids=${this.id()}`,
  );

  /** What happened, then what's still to come. */
  protected readonly steps = computed<TimelineStep[]>(() => {
    const p = this.parcel();
    if (!p) return [];
    const done: TimelineStep[] = p.scans.map((s, i) => ({
      label: STATUS_LABELS[s.to],
      at: s.at,
      detail: `${s.by} · ${ROLE_LABELS[s.role]}`,
      state: s.undoneAt ? 'undone' : i === p.scans.length - 1 ? 'current' : 'done',
    }));
    // The last live scan is the current step.
    const live = done.filter((d) => d.state !== 'undone');
    for (const d of live) d.state = 'done';
    const last = live.at(-1);
    if (last && p.status !== 'collected') last.state = 'current';
    const next = p.status === 'cancelled' ? [] : PATH.slice(PATH.indexOf(p.status) + 1);
    return [...done, ...next.map((s): TimelineStep => ({ label: STATUS_LABELS[s], at: null, state: 'upcoming' }))];
  });

  constructor() {
    effect(() => {
      void this.load(this.network(), this.id());
    });
  }

  protected async cancel(): Promise<void> {
    const p = this.parcel();
    if (!p) return;
    const ok = await this.confirm.confirm({
      title: `Cancel parcel ${code(p.code)}?`,
      message: 'The customer gets an email that the delivery was cancelled. You can’t undo this.',
      confirmLabel: 'Cancel parcel',
      cancelLabel: 'Keep it',
      danger: true,
    });
    if (!ok) return;
    try {
      await this.api.post(`/api/n/${encodeURIComponent(this.network())}/parcels/${p.id}/cancel`);
      this.toaster.show(`Cancelled ${code(p.code)}.`, { tone: 'success' });
      await this.load(this.network(), this.id());
    } catch (error) {
      this.toaster.show(errorText(error), { tone: 'danger' });
    }
  }

  private async load(network: string, id: string): Promise<void> {
    this.error.set(null);
    const path = `/api/n/${encodeURIComponent(network)}/parcels/${id}`;
    try {
      const parcel = await this.loading.track(
        this.api.get<Parcel>(path, {
          onFresh: (fresh) => {
            if (id === this.id()) this.parcel.set(fresh);
          },
        }),
      );
      if (id === this.id()) this.parcel.set(parcel);
    } catch (error) {
      this.error.set(errorText(error));
    }
  }
}
