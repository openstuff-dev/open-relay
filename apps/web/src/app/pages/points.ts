import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type { OpeningHours, Point, PointInput } from '@open-relay/contracts';
import {
  Badge,
  Button,
  Callout,
  Cell,
  ConfirmDialog,
  Control,
  DataTable,
  Dialog,
  DialogBody,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Icon,
  onReturn,
  PageHeader,
  Skeleton,
  slowLoading,
  Switch,
  Toaster,
} from '@openstuff-dev/ui-angular';
import { Api, errorText } from '../core/api';
import { IdempotencyKey } from '../core/idempotency';
import { iconPlus } from '../shared/icons';
import { WEEKDAYS } from '../shared/labels';

const EMPTY = (): PointInput & { id: string | null; latText: string; lngText: string } => ({
  id: null,
  name: '',
  street: '',
  postcode: '',
  city: '',
  latText: '',
  lngText: '',
  openingHours: ['9–18', '9–18', '9–18', '9–18', '9–18', '10–14', 'closed'],
  active: true,
});

/** Where customers collect their parcels. Admins add and edit them. */
@Component({
  selector: 'app-points',
  imports: [
    FormsModule,
    RouterLink,
    Badge,
    Button,
    Callout,
    Cell,
    Control,
    DataTable,
    Dialog,
    DialogBody,
    DialogClose,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Field,
    Icon,
    PageHeader,
    Skeleton,
    Switch,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'stack' },
  template: `
    <header
      os-page-header
      title="Pick-up points"
      description="Shops and kiosks where customers collect their parcels. Closed points aren’t offered for new parcels."
    >
      <button type="button" os-button variant="primary" (click)="edit(null)">
        <svg os-icon [icon]="iconPlus" size="sm"></svg>New point
      </button>
    </header>
    @if (error(); as error) {
      <os-callout tone="danger" title="The points didn’t load">{{ error }}</os-callout>
    }
    @if (points(); as points) {
      <os-data-table
        caption="Pick-up points"
        [columns]="columns"
        [rows]="points"
        rowKey="id"
        empty="No pick-up points yet."
      >
        <ng-template os-cell="name" let-p>
          <button type="button" os-button variant="link" (click)="edit(p)">{{ p.name }}</button>
          <span class="os-cell-sub">{{ p.street }}, {{ p.postcode }} {{ p.city }}</span>
        </ng-template>
        <ng-template os-cell="waiting" let-p>
          <a
            class="nums"
            [routerLink]="['/n', network(), 'parcels']"
            [queryParams]="{ pointId: p.id, status: 'at_point' }"
            >{{ p.waiting }}</a
          >
        </ng-template>
        <ng-template os-cell="active" let-p>
          <span os-badge [tone]="p.active ? 'success' : 'neutral'">{{
            p.active ? 'Open' : 'Closed'
          }}</span>
          @if (p.lat === null) {
            <span class="os-cell-sub">No coordinates</span>
          }
        </ng-template>
      </os-data-table>
    } @else if (loading.slow()) {
      <os-skeleton [lines]="5" />
    }

    <dialog os-dialog [(open)]="open">
      <header os-dialog-header>
        <h2 os-dialog-title>{{ form.id ? 'Edit ' + form.name : 'New pick-up point' }}</h2>
      </header>
      <form id="point-form" os-dialog-body class="stack" (ngSubmit)="save()">
        @if (saveError(); as e) {
          <os-callout tone="danger">{{ e }}</os-callout>
        }
        <os-field label="Name">
          <input os-input name="name" required maxlength="120" [(ngModel)]="form.name" />
        </os-field>
        <os-field label="Street">
          <input os-input name="street" required [(ngModel)]="form.street" />
        </os-field>
        <div class="inline">
          <os-field label="Postcode">
            <input os-input name="postcode" required class="short" [(ngModel)]="form.postcode" />
          </os-field>
          <os-field label="City">
            <input os-input name="city" required [(ngModel)]="form.city" />
          </os-field>
        </div>
        <div class="inline">
          <os-field label="Latitude (optional)">
            <input
              os-input
              name="lat"
              inputmode="decimal"
              class="short"
              [(ngModel)]="form.latText"
            />
          </os-field>
          <os-field label="Longitude (optional)">
            <input
              os-input
              name="lng"
              inputmode="decimal"
              class="short"
              [(ngModel)]="form.lngText"
            />
          </os-field>
        </div>
        <p class="muted hint">
          With coordinates, customers are offered the nearest points. Leave them empty to have the
          geocoder fill them in, if the server has one.
        </p>
        <fieldset class="hours">
          <legend>Opening hours</legend>
          @for (day of weekdays; track $index) {
            <os-field [label]="day">
              <input
                os-input
                [name]="'h' + $index"
                maxlength="40"
                [(ngModel)]="form.openingHours[$index]"
              />
            </os-field>
          }
        </fieldset>
        <label class="switch">
          <input type="checkbox" os-switch name="active" [(ngModel)]="form.active" /> Open for new
          parcels
        </label>
      </form>
      <footer os-dialog-footer>
        @if (form.id) {
          <button
            os-button
            type="button"
            variant="ghost"
            tone="danger"
            class="start"
            (click)="remove()"
          >
            Delete
          </button>
        }
        <button os-button os-dialog-close type="button">Cancel</button>
        <button os-button variant="primary" type="submit" form="point-form" [loading]="saving()">
          Save
        </button>
      </footer>
    </dialog>
  `,
  styles: `
    .short {
      max-inline-size: 9rem;
    }

    .hint {
      margin: 0;
      font-size: var(--os-text-sm);
    }

    .hours {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(8rem, 1fr));
      gap: var(--os-space-3);
      margin: 0;
      padding: 0;
      border: 0;
    }

    legend {
      margin-block-end: var(--os-space-2);
      font-weight: var(--os-font-weight-medium);
    }

    .switch {
      display: flex;
      gap: var(--os-space-2);
      align-items: center;
    }

    .start {
      margin-inline-end: auto;
    }
  `,
})
export class Points {
  readonly network = input.required<string>();
  private readonly api = inject(Api);
  private readonly toaster = inject(Toaster);
  private readonly confirm = inject(ConfirmDialog);
  protected readonly points = signal<Point[] | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly loading = slowLoading();
  protected readonly iconPlus = iconPlus;
  protected readonly weekdays = WEEKDAYS;
  protected readonly columns = [
    { key: 'name' as const, label: 'Point' },
    { key: 'waiting' as const, label: 'Waiting', align: 'end' as const },
    { key: 'active' as const, label: 'Status' },
  ];

  protected readonly open = signal(false);
  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);
  protected form = EMPTY();
  private readonly key = new IdempotencyKey();

  constructor() {
    effect(() => {
      void this.load(this.network());
    });
    inject(DestroyRef).onDestroy(onReturn(() => void this.load(this.network())));
  }

  private get base(): string {
    return `/api/n/${encodeURIComponent(this.network())}/points`;
  }

  protected edit(p: Point | null): void {
    this.saveError.set(null);
    this.form = p
      ? {
          ...p,
          latText: p.lat === null ? '' : String(p.lat),
          lngText: p.lng === null ? '' : String(p.lng),
          openingHours: [...p.openingHours] as OpeningHours,
        }
      : EMPTY();
    this.open.set(true);
  }

  protected async save(): Promise<void> {
    const f = this.form;
    const num = (t: string) => (t.trim() === '' ? null : Number(t.replace(',', '.')));
    const lat = num(f.latText);
    const lng = num(f.lngText);
    const bad = (n: number | null) => n !== null && Number.isNaN(n);
    if ((lat === null) !== (lng === null) || bad(lat) || bad(lng)) {
      this.saveError.set('Give both latitude and longitude as numbers, or leave both empty.');
      return;
    }
    const body: PointInput = {
      name: f.name,
      street: f.street,
      postcode: f.postcode,
      city: f.city,
      lat,
      lng,
      openingHours: f.openingHours,
      active: f.active,
    };
    this.saving.set(true);
    this.saveError.set(null);
    try {
      const saved = f.id
        ? await this.api.patch<Point>(`${this.base}/${f.id}`, body)
        : await this.api.post<Point>(this.base, body, this.key.value);
      if (!f.id) this.key.renew();
      this.points.update((list) => {
        const rest = (list ?? []).filter((p) => p.id !== saved.id);
        return [...rest, saved].sort((a, b) => a.name.localeCompare(b.name));
      });
      this.open.set(false);
      this.toaster.show(`Saved ${saved.name}.`, { tone: 'success' });
    } catch (error) {
      this.saveError.set(errorText(error));
    } finally {
      this.saving.set(false);
    }
  }

  protected async remove(): Promise<void> {
    const f = this.form;
    if (!f.id) return;
    const ok = await this.confirm.confirm({
      title: `Delete ${f.name}?`,
      message: 'Only points that never had a parcel can be deleted. To stop new parcels, close it instead.',
      confirmLabel: 'Delete point',
      danger: true,
    });
    if (!ok) return;
    try {
      await this.api.delete(`${this.base}/${f.id}`);
      this.points.update((list) => list?.filter((p) => p.id !== f.id) ?? null);
      this.open.set(false);
    } catch (error) {
      this.saveError.set(errorText(error));
    }
  }

  private async load(network: string): Promise<void> {
    this.error.set(null);
    try {
      const points = await this.loading.track(
        this.api.get<Point[]>(`/api/n/${encodeURIComponent(network)}/points`, {
          onFresh: (fresh) => { if (network === this.network()) this.points.set(fresh); },
        }),
      );
      if (network === this.network()) this.points.set(points);
    } catch (error) {
      this.error.set(errorText(error));
    }
  }
}
