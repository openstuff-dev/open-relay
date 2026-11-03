import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import type { Merchant, ParcelRow, SuggestedPoint } from '@open-relay/contracts';
import { Button, Callout, Control, Field, Fieldset, PageHeader, Toaster } from '@openstuff-dev/ui-angular';
import { Api, errorText } from '../core/api';
import { IdempotencyKey } from '../core/idempotency';
import { Session } from '../core/session';
import { code } from '../shared/labels';

/** A parcel by hand: the customer, then one of the points nearest them. */
@Component({
  selector: 'app-new-parcel',
  imports: [FormsModule, RouterLink, Button, Callout, Control, Field, Fieldset, PageHeader],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'stack' },
  template: `
    <nav><a [routerLink]="['/n', network(), 'parcels']">← Parcels</a></nav>
    <header
      os-page-header
      title="New parcel"
      description="The customer gets an email with where to collect it and a link to follow it."
    ></header>

    <form class="stack form" (ngSubmit)="save()">
      @if (error(); as error) {
        <os-callout tone="danger" title="The parcel wasn’t added">{{ error }}</os-callout>
      }
      @if (session.isAdmin()) {
        <os-field label="Shop">
          <select os-select name="merchant" required [(ngModel)]="merchantId">
            @for (m of merchants(); track m.id) {
              <option [value]="m.id">{{ m.name }}</option>
            }
          </select>
        </os-field>
      }

      <fieldset os-fieldset>
        <legend>Customer</legend>
        <os-field label="Name">
          <input
            os-input
            name="name"
            autocomplete="off"
            required
            maxlength="120"
            [(ngModel)]="customer.name"
          />
        </os-field>
        <os-field label="Email" hint="Where the emails about this parcel go.">
          <input
            os-input
            type="email"
            name="email"
            autocomplete="off"
            required
            [(ngModel)]="customer.email"
          />
        </os-field>
        <os-field label="Phone (optional)">
          <input os-input type="tel" name="phone" autocomplete="off" [(ngModel)]="customer.phone" />
        </os-field>
        <os-field label="Street">
          <input
            os-input
            name="street"
            autocomplete="off"
            [(ngModel)]="customer.street"
            (blur)="suggest()"
          />
        </os-field>
        <div class="inline">
          <os-field label="Postcode">
            <input
              os-input
              name="postcode"
              autocomplete="off"
              class="short"
              [(ngModel)]="customer.postcode"
              (blur)="suggest()"
            />
          </os-field>
          <os-field label="City">
            <input
              os-input
              name="city"
              autocomplete="off"
              [(ngModel)]="customer.city"
              (blur)="suggest()"
            />
          </os-field>
        </div>
        <os-field
          label="Order number (optional)"
          hint="Your own reference, e.g. #1042. It’s on the label."
        >
          <input os-input name="reference" maxlength="100" [(ngModel)]="reference" />
        </os-field>
      </fieldset>

      <fieldset os-fieldset>
        <legend>Pick-up point</legend>
        @if (points().length) {
          <div class="points" role="radiogroup" aria-label="Pick-up point">
            @for (p of points(); track p.id; let first = $first) {
              <label class="point" [class.chosen]="pointId === p.id">
                <input type="radio" name="point" [value]="p.id" required [(ngModel)]="pointId" />
                <span>
                  <strong>{{ p.name }}</strong>
                  @if (first) {
                    <span class="muted"> · nearest</span>
                  }
                  <br />
                  <span class="muted">{{ p.street }}, {{ p.postcode }} {{ p.city }}</span>
                  @if (p.distanceKm !== null) {
                    <span class="muted nums"> · {{ p.distanceKm }} km</span>
                  }
                </span>
              </label>
            }
          </div>
        } @else if (suggestError(); as e) {
          <os-callout tone="warning">{{ e }}</os-callout>
        } @else {
          <p class="muted">Add the customer’s postcode to see the points nearest them.</p>
        }
      </fieldset>

      <div class="inline">
        <button
          os-button
          variant="primary"
          type="submit"
          [loading]="saving()"
          [disabled]="!pointId"
        >
          Add parcel
        </button>
        <a os-button [routerLink]="['/n', network(), 'parcels']">Cancel</a>
      </div>
    </form>
  `,
  styles: `
    .form {
      max-inline-size: 36rem;
    }

    .short {
      max-inline-size: 8rem;
    }

    .points {
      display: grid;
      gap: var(--os-space-2);
    }

    .point {
      display: flex;
      gap: var(--os-space-3);
      align-items: start;
      padding: var(--os-space-3);
      border: 1px var(--os-border-style) var(--os-border-default);
      border-radius: var(--os-radius-md);
      cursor: pointer;
    }

    .point.chosen {
      border-color: var(--os-brand-default);
      background: var(--os-brand-soft);
    }

    .point input {
      margin-block-start: 0.2rem;
    }

    p {
      margin: 0;
    }
  `,
})
export class NewParcel {
  readonly network = input.required<string>();
  protected readonly session = inject(Session);
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  private readonly toaster = inject(Toaster);
  protected readonly merchants = signal<Merchant[]>([]);
  protected readonly points = signal<SuggestedPoint[]>([]);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly suggestError = signal<string | null>(null);
  protected merchantId = '';
  protected pointId = '';
  protected reference = '';
  protected customer = { name: '', email: '', phone: '', street: '', postcode: '', city: '' };
  private readonly key = new IdempotencyKey();
  private lastAddress = '';

  constructor() {
    effect(() => {
      // Only admins pick the shop; merchant staff add parcels for their own.
      if (this.session.isAdmin()) void this.loadMerchants(this.network());
    });
  }

  private get base(): string {
    return `/api/n/${encodeURIComponent(this.network())}`;
  }

  private async loadMerchants(network: string): Promise<void> {
    try {
      const merchants = await this.api.get<Merchant[]>(`/api/n/${encodeURIComponent(network)}/merchants`);
      this.merchants.set(merchants);
      this.merchantId ||= merchants[0]?.id ?? '';
    } catch (error) {
      this.error.set(errorText(error));
    }
  }

  /** The nearest points, once the address changed; the nearest is picked. */
  protected async suggest(): Promise<void> {
    const { street, postcode, city } = this.customer;
    const address = `${street}|${postcode}|${city}`;
    if (!postcode && !city) return;
    if (address === this.lastAddress) return;
    this.lastAddress = address;
    this.suggestError.set(null);
    try {
      const params = new URLSearchParams({ street, postcode, city });
      const points = await this.api.get<SuggestedPoint[]>(`${this.base}/points/suggest?${params.toString()}`);
      this.points.set(points);
      if (!points.some((p) => p.id === this.pointId)) this.pointId = points[0]?.id ?? '';
      if (!points.length) this.suggestError.set('This network has no open pick-up points yet.');
    } catch (error) {
      this.suggestError.set(errorText(error));
    }
  }

  protected async save(): Promise<void> {
    this.saving.set(true);
    this.error.set(null);
    try {
      const parcel = await this.api.post<ParcelRow>(
        `${this.base}/parcels`,
        {
          merchantId: this.session.isAdmin() ? this.merchantId : undefined,
          pointId: this.pointId,
          reference: this.reference || null,
          customer: { ...this.customer, phone: this.customer.phone || null },
        },
        this.key.value,
      );
      this.key.renew();
      this.toaster.show(`Added ${code(parcel.code)}. Print its label next.`, { tone: 'success' });
      await this.router.navigate(['/n', this.network(), 'parcels', parcel.id]);
    } catch (error) {
      this.error.set(errorText(error));
    } finally {
      this.saving.set(false);
    }
  }
}
