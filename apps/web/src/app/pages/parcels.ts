import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import type { CsvImportResult, ParcelsPage, ParcelStatus } from '@open-relay/contracts';
import {
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
} from '@openstuff-dev/ui-angular';
import { Api, errorText } from '../core/api';
import { onReturn, slowLoading } from '../core/loading';
import { Session } from '../core/session';
import { iconPlus, iconPrint, iconUpload } from '../shared/icons';
import { STATUS_LABELS, STATUS_TONES, code, shortDate } from '../shared/labels';

const FILTERS: { value: ParcelStatus | 'overdue' | ''; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'registered', label: STATUS_LABELS.registered },
  { value: 'ready', label: STATUS_LABELS.ready },
  { value: 'in_transit', label: STATUS_LABELS.in_transit },
  { value: 'at_point', label: STATUS_LABELS.at_point },
  { value: 'overdue', label: 'Overdue' },
  { value: 'collected', label: STATUS_LABELS.collected },
  { value: 'cancelled', label: STATUS_LABELS.cancelled },
];

interface FilterChange {
  status?: string;
  merchantId?: string;
  pointId?: string;
  q?: string;
  page?: number;
}

/** Every parcel this person may see, newest change first, with filters that live in the URL. */
@Component({
  selector: 'app-parcels',
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
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'stack' },
  template: `
    <header os-page-header title="Parcels" [description]="description()">
      @if (session.isShop()) {
        <button type="button" os-button (click)="openImport()">
          <svg os-icon [icon]="icons.upload" size="sm"></svg>Import CSV
        </button>
        <a os-button variant="primary" [routerLink]="['/n', network(), 'parcels', 'new']">
          <svg os-icon [icon]="icons.plus" size="sm"></svg>New parcel
        </a>
      }
    </header>

    <form class="inline filters" role="search" (ngSubmit)="apply({ q: q, page: 1 })">
      <os-field label="Search">
        <input
          os-input
          type="search"
          name="q"
          placeholder="Code, order, customer"
          [(ngModel)]="q"
        />
      </os-field>
      <os-field label="Status">
        <select
          os-select
          name="status"
          [ngModel]="status() ?? ''"
          (ngModelChange)="apply({ status: $event, page: 1 })"
        >
          @for (f of filters; track f.value) {
            <option [value]="f.value">{{ f.label }}</option>
          }
        </select>
      </os-field>
      @if (data(); as d) {
        @if (session.role() !== 'merchant' && d.merchants.length > 1) {
          <os-field label="Shop">
            <select
              os-select
              name="merchant"
              [ngModel]="merchantId() ?? ''"
              (ngModelChange)="apply({ merchantId: $event, page: 1 })"
            >
              <option value="">All shops</option>
              @for (m of d.merchants; track m.id) {
                <option [value]="m.id">{{ m.name }}</option>
              }
            </select>
          </os-field>
        }
        @if (session.role() !== 'point' && d.points.length > 1) {
          <os-field label="Pick-up point">
            <select
              os-select
              name="point"
              [ngModel]="pointId() ?? ''"
              (ngModelChange)="apply({ pointId: $event, page: 1 })"
            >
              <option value="">All points</option>
              @for (p of d.points; track p.id) {
                <option [value]="p.id">{{ p.name }}</option>
              }
            </select>
          </os-field>
        }
      }
      <button os-button type="submit">Search</button>
    </form>

    @if (error(); as error) {
      <os-callout tone="danger" title="The parcels didn’t load">{{ error }}</os-callout>
    }

    @if (data(); as d) {
      @if (session.isShop() && toPrint().length) {
        <div>
          <a os-button size="sm" target="_blank" rel="noopener" [href]="labelsUrl()">
            <svg os-icon [icon]="icons.print" size="sm"></svg>Print {{ toPrint().length }}
            {{ toPrint().length === 1 ? 'label' : 'labels' }} for new parcels
          </a>
        </div>
      }
      <os-data-table
        caption="Parcels"
        [columns]="columns"
        [rows]="rows()"
        rowKey="id"
        [empty]="emptyText()"
      >
        <ng-template os-cell="code" let-p>
          <a class="code" [routerLink]="['/n', network(), 'parcels', p.id]">{{ fmt(p.code) }}</a>
          @if (p.reference) {
            <span class="os-cell-sub">{{ p.reference }}</span>
          }
        </ng-template>
        <ng-template os-cell="status" let-p>
          <span os-badge [tone]="p.overdue ? 'danger' : tones[asStatus(p.status)]">{{
            p.overdue ? 'Overdue' : labels[asStatus(p.status)]
          }}</span>
        </ng-template>
        <ng-template os-cell="customerName" let-p>
          {{ p.customerName ?? '—' }}
        </ng-template>
        <ng-template os-cell="route" let-p>
          {{ p.merchant.name }} → {{ p.point.name }}
        </ng-template>
        <ng-template os-cell="updatedAt" let-p>
          <span class="nums">{{ date(p.updatedAt) }}</span>
        </ng-template>
      </os-data-table>
      @if (pages() > 1) {
        <nav class="inline pager" aria-label="Pages">
          <button
            os-button
            size="sm"
            type="button"
            [disabled]="currentPage() <= 1"
            (click)="apply({ page: currentPage() - 1 })"
          >
            Previous
          </button>
          <span class="nums muted"
            >Page {{ currentPage() }} of {{ pages() }} · {{ d.total }} parcels</span
          >
          <button
            os-button
            size="sm"
            type="button"
            [disabled]="currentPage() >= pages()"
            (click)="apply({ page: currentPage() + 1 })"
          >
            Next
          </button>
        </nav>
      }
    } @else if (loading.slow()) {
      <os-skeleton [lines]="8" />
    }

    <dialog os-dialog [(open)]="importOpen">
      <header os-dialog-header><h2 os-dialog-title>Import parcels from CSV</h2></header>
      <div os-dialog-body class="stack">
        <p>
          The first row names the columns: <code>name</code> and <code>email</code> are needed;
          <code>phone</code>, <code>street</code>, <code>postcode</code>, <code>city</code>,
          <code>reference</code> and <code>point</code> are optional. Without a point, the nearest
          one is picked from the postcode. Each customer gets an email.
        </p>
        @if (session.role() === 'admin' && data(); as d) {
          <os-field label="Shop">
            <select os-select name="importMerchant" [(ngModel)]="importMerchant">
              @for (m of d.merchants; track m.id) {
                <option [value]="m.id">{{ m.name }}</option>
              }
            </select>
          </os-field>
        }
        <label class="file">
          <span class="os-visually-hidden">CSV file</span>
          <input
            type="file"
            accept=".csv,text/csv"
            [disabled]="importing()"
            (change)="importFile($event)"
          />
        </label>
        @if (importResult(); as r) {
          <os-callout
            [tone]="r.errors.length ? 'warning' : 'success'"
            [title]="'Added ' + r.created + ' parcels'"
          >
            @if (r.errors.length) {
              <ul>
                @for (e of r.errors.slice(0, 20); track e.row) {
                  <li>Row {{ e.row }}: {{ e.error }}</li>
                }
              </ul>
            }
          </os-callout>
        }
        @if (importError(); as e) {
          <os-callout tone="danger" title="Nothing was imported">{{ e }}</os-callout>
        }
      </div>
      <footer os-dialog-footer>
        <button os-button os-dialog-close type="button">Close</button>
      </footer>
    </dialog>
  `,
  styles: `
    .filters os-field {
      min-inline-size: 10rem;
    }

    .pager {
      align-items: center;
      justify-content: space-between;
    }

    p {
      margin: 0;
      max-inline-size: 60ch;
    }
  `,
})
export class Parcels {
  readonly network = input.required<string>();
  readonly status = input<string>();
  readonly merchantId = input<string>();
  readonly pointId = input<string>();
  readonly search = input<string>();
  /** From ?page=…; `currentPage` is the number. */
  readonly page = input<string>();

  protected readonly session = inject(Session);
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  protected readonly data = signal<ParcelsPage | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly loading = slowLoading();
  protected readonly filters = FILTERS;
  protected readonly labels = STATUS_LABELS;
  protected readonly tones = STATUS_TONES;
  protected readonly icons = { plus: iconPlus, upload: iconUpload, print: iconPrint };
  protected readonly fmt = code;
  protected readonly date = shortDate;
  protected readonly asStatus = (s: string) => s as ParcelStatus;
  protected readonly columns = [
    { key: 'code' as const, label: 'Parcel' },
    { key: 'status' as const, label: 'Status' },
    { key: 'customerName' as const, label: 'Customer' },
    { key: 'route' as const, label: 'From → to' },
    { key: 'updatedAt' as const, label: 'Last change', align: 'end' as const },
  ];

  /** DataTable shows row properties; the route column needs one too. */
  protected readonly rows = computed(() => this.data()?.parcels.map((p) => ({ ...p, route: '' })) ?? []);
  protected q = '';
  protected readonly currentPage = computed(() => Math.max(1, Number(this.page() ?? 1) || 1));
  protected readonly pages = computed(() => Math.ceil((this.data()?.total ?? 0) / 50));
  protected readonly description = computed(() =>
    ({
      admin: 'Every parcel in this network.',
      merchant: 'Your shop’s parcels. Print a label, stick it on, and scan it when it’s packed.',
      point: 'Parcels on their way to your point, waiting there, or collected.',
      courier: '',
    })[this.session.role() ?? 'admin'],
  );

  protected readonly emptyText = computed(() =>
    this.status() || this.search() ? 'No parcels match. Try other filters.' : 'No parcels yet.',
  );

  protected readonly toPrint = computed(
    () => this.data()?.parcels.filter((p) => p.status === 'registered').map((p) => p.id) ?? [],
  );

  protected readonly labelsUrl = computed(
    () => `/api/n/${encodeURIComponent(this.network())}/labels?ids=${this.toPrint().join(',')}`,
  );

  // Import
  protected readonly importOpen = signal(false);
  protected readonly importing = signal(false);
  protected readonly importResult = signal<CsvImportResult | null>(null);
  protected readonly importError = signal<string | null>(null);
  protected importMerchant = '';

  constructor() {
    effect(() => {
      this.q = this.search() ?? '';
      void this.load(this.query());
    });
    inject(DestroyRef).onDestroy(onReturn(() => void this.load(this.query())));
  }

  private query(): string {
    const params = new URLSearchParams();
    const add = (k: string, v: string | undefined) => {
      if (v) params.set(k, v);
    };
    add('status', this.status());
    add('merchantId', this.merchantId());
    add('pointId', this.pointId());
    add('q', this.search());
    if (this.currentPage() > 1) params.set('page', String(this.currentPage()));
    return `/api/n/${encodeURIComponent(this.network())}/parcels?${params.toString()}`;
  }

  /** Filters go into the URL, so they survive a reload and can be shared. */
  protected apply(change: FilterChange): void {
    const params = {
      status: this.status(),
      merchantId: this.merchantId(),
      pointId: this.pointId(),
      search: this.search(),
      page: this.page(),
      ...('status' in change ? { status: change.status } : {}),
      ...('merchantId' in change ? { merchantId: change.merchantId } : {}),
      ...('pointId' in change ? { pointId: change.pointId } : {}),
      ...('q' in change ? { search: change.q } : {}),
      ...(change.page ? { page: change.page > 1 ? String(change.page) : undefined } : {}),
    };
    const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v));
    void this.router.navigate([], { queryParams: clean });
  }

  protected openImport(): void {
    this.importResult.set(null);
    this.importError.set(null);
    this.importMerchant = this.data()?.merchants[0]?.id ?? '';
    this.importOpen.set(true);
  }

  protected async importFile(event: Event): Promise<void> {
    const el = event.target as HTMLInputElement;
    const file = el.files?.[0];
    if (!file) return;
    this.importing.set(true);
    this.importResult.set(null);
    this.importError.set(null);
    try {
      const csv = await file.text();
      const body = this.session.role() === 'admin' ? { csv, merchantId: this.importMerchant } : { csv };
      this.importResult.set(
        await this.api.post<CsvImportResult>(`/api/n/${encodeURIComponent(this.network())}/parcels/import`, body),
      );
      void this.load(this.query());
    } catch (error) {
      this.importError.set(errorText(error));
    } finally {
      this.importing.set(false);
      el.value = '';
    }
  }

  private async load(path: string): Promise<void> {
    this.error.set(null);
    try {
      const page = await this.loading.track(
        this.api.get<ParcelsPage>(path, {
          onFresh: (fresh) => {
            if (path === this.query()) this.data.set(fresh);
          },
        }),
      );
      if (path === this.query()) this.data.set(page);
    } catch (error) {
      this.error.set(errorText(error));
    }
  }
}
