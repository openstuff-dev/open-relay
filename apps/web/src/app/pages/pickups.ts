import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { PickupStop } from '@open-relay/contracts';
import {
  Button,
  Callout,
  EmptyState,
  Icon,
  onReturn,
  PageHeader,
  Skeleton,
  slowLoading,
} from '@openstuff-dev/ui-angular';
import { Api, errorText } from '../core/api';
import { iconScan } from '../shared/icons';
import { code } from '../shared/labels';

/** The courier's round: which shops have parcels ready, and where each one goes. */
@Component({
  selector: 'app-pickups',
  imports: [RouterLink, Button, Callout, EmptyState, Icon, PageHeader, Skeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'stack' },
  template: `
    <header
      os-page-header
      title="Pickups"
      description="Parcels the shops have packed and marked ready."
    >
      <a os-button variant="primary" [routerLink]="['/n', network(), 'scan']">
        <svg os-icon [icon]="iconScan" size="sm"></svg>Scan
      </a>
    </header>
    @if (error(); as error) {
      <os-callout tone="danger" title="The pickups didn’t load">{{ error }}</os-callout>
    }
    @if (stops(); as stops) {
      @for (stop of stops; track stop.merchant.id) {
        <section class="stop" [attr.aria-labelledby]="'stop-' + stop.merchant.id">
          <h2 [id]="'stop-' + stop.merchant.id">
            {{ stop.merchant.name }}
            <span class="muted nums"
              >{{ stop.parcels.length }}
              {{ stop.parcels.length === 1 ? 'parcel' : 'parcels' }}</span
            >
          </h2>
          @if (stop.merchant.address) {
            <p class="muted">{{ stop.merchant.address }}</p>
          }
          <ul>
            @for (p of stop.parcels; track p.id) {
              <li>
                <span class="code">{{ fmt(p.code) }}</span>
                <span class="muted">→ {{ p.point }}</span>
              </li>
            }
          </ul>
        </section>
      } @empty {
        <os-empty-state title="Nothing to pick up">
          When a shop marks a parcel ready, it shows here.
        </os-empty-state>
      }
    } @else if (loading.slow()) {
      <os-skeleton [lines]="6" />
    }
  `,
  styles: `
    .stop {
      display: grid;
      gap: var(--os-space-2);
      padding: var(--os-space-4);
      border: 1px var(--os-border-style) var(--os-border-default);
      border-radius: var(--os-radius-lg);
    }

    h2 {
      display: flex;
      flex-wrap: wrap;
      gap: var(--os-space-2);
      align-items: baseline;
      margin: 0;
      font-size: var(--os-text-lg);
    }

    h2 .muted {
      font-size: var(--os-text-sm);
      font-weight: var(--os-font-weight-regular);
    }

    p {
      margin: 0;
    }

    ul {
      display: grid;
      gap: var(--os-space-1);
      margin: 0;
      padding-inline-start: var(--os-space-5);
    }
  `,
})
export class Pickups {
  readonly network = input.required<string>();
  private readonly api = inject(Api);
  protected readonly stops = signal<PickupStop[] | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly loading = slowLoading();
  protected readonly iconScan = iconScan;
  protected readonly fmt = code;

  constructor() {
    effect(() => {
      void this.load(this.network());
    });
    inject(DestroyRef).onDestroy(onReturn(() => void this.load(this.network())));
  }

  private async load(network: string): Promise<void> {
    this.error.set(null);
    try {
      const stops = await this.loading.track(
        this.api.get<PickupStop[]>(`/api/n/${encodeURIComponent(network)}/pickups`, {
          onFresh: (fresh) => { if (network === this.network()) this.stops.set(fresh); },
        }),
      );
      if (network === this.network()) this.stops.set(stops);
    } catch (error) {
      this.error.set(errorText(error));
    }
  }
}
