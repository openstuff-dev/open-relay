import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type { Network } from '@open-relay/contracts';
import {
  Button,
  Callout,
  Cell,
  Control,
  DataTable,
  Field,
  SectionHeader,
  SettingCard,
  SettingCardBody,
  SettingCardFooter,
  Skeleton,
  slowLoading,
} from '@openstuff-dev/ui-angular';
import { Api, errorText } from '../../core/api';
import { IdempotencyKey } from '../../core/idempotency';
import { Session } from '../../core/session';
import { shortDate } from '../../shared/labels';

/** For server admins: every network on this server. */
@Component({
  selector: 'app-networks',
  imports: [
    FormsModule,
    RouterLink,
    Button,
    Callout,
    Cell,
    Control,
    DataTable,
    Field,
    SectionHeader,
    SettingCard,
    SettingCardBody,
    SettingCardFooter,
    Skeleton,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'stack' },
  template: `
    <header
      os-section-header
      title="Networks"
      description="Each network is a delivery network with its own shops, pick-up points, couriers and parcels. Networks can’t see each other."
    ></header>

    <form
      os-setting-card
      title="Add a network"
      description="Make a network to start. You become its admin."
      (ngSubmit)="create()"
    >
      <div os-setting-card-body>
        <os-field label="Network name" [error]="createError()">
          <input
            os-input
            name="name"
            required
            maxlength="120"
            placeholder="City Parcels"
            [(ngModel)]="name"
          />
        </os-field>
      </div>
      <div os-setting-card-footer>
        <button os-button variant="primary" type="submit" [loading]="creating()">
          Add network
        </button>
      </div>
    </form>

    @if (error(); as error) {
      <os-callout tone="danger" title="The networks didn’t load">{{ error }}</os-callout>
    }
    @if (networks(); as networks) {
      <os-data-table
        caption="Networks"
        [columns]="columns"
        [rows]="networks"
        rowKey="id"
        empty="No networks yet."
      >
        <ng-template os-cell="name" let-t>
          <a [routerLink]="['/n', t.slug]">{{ t.name }}</a>
          <span class="os-cell-sub">{{ t.slug }}</span>
        </ng-template>
        <ng-template os-cell="createdAt" let-t>
          <span class="nums">{{ date(t.createdAt) }}</span>
        </ng-template>
      </os-data-table>
    } @else if (loading.slow()) {
      <os-skeleton [lines]="4" />
    }
  `,
  styles: `
    .nums {
      font-variant-numeric: tabular-nums;
    }
  `,
})
export class Networks {
  private readonly api = inject(Api);
  private readonly session = inject(Session);
  protected readonly networks = signal<Network[] | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly loading = slowLoading();
  protected readonly columns = [
    { key: 'name' as const, label: 'Network' },
    { key: 'createdAt' as const, label: 'Added' },
  ];

  protected readonly date = shortDate;
  protected name = '';
  protected readonly creating = signal(false);
  protected readonly createError = signal<string | null>(null);
  private readonly key = new IdempotencyKey();

  constructor() {
    void this.load();
  }

  protected async create(): Promise<void> {
    this.creating.set(true);
    this.createError.set(null);
    try {
      const network = await this.api.post<Network>('/api/networks', { name: this.name }, this.key.value);
      this.key.renew();
      this.name = '';
      const byName = (a: Network, b: Network) => a.name.localeCompare(b.name);
      this.networks.update((t) => t && [...t, network].sort(byName));
      await this.session.load();
    } catch (error) {
      this.createError.set(errorText(error));
    } finally {
      this.creating.set(false);
    }
  }

  private async load(): Promise<void> {
    try {
      this.networks.set(
        await this.loading.track(
          this.api.get<Network[]>('/api/networks', {
            onFresh: (t) => {
              this.networks.set(t);
            },
          }),
        ),
      );
    } catch (error) {
      this.error.set(errorText(error));
    }
  }
}
