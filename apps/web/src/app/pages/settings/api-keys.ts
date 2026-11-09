import {
  ChangeDetectionStrategy,
  Component,
  type ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type { ApiKey, Merchant, NewApiKey } from '@open-relay/contracts';
import {
  Button,
  Callout,
  Cell,
  ConfirmDialog,
  Control,
  DataTable,
  EmptyState,
  Field,
  SecretDialog,
  SectionHeader,
  SettingCard,
  SettingCardBody,
  SettingCardFooter,
  Skeleton,
  slowLoading,
  Toaster,
} from '@openstuff-dev/ui-angular';
import { Api, errorText } from '../../core/api';
import { IdempotencyKey } from '../../core/idempotency';
import { shortDate } from '../../shared/labels';

/** Keys a shop's own system uses to add parcels and find points, until shop plugins exist. */
@Component({
  selector: 'app-api-keys',
  imports: [
    FormsModule,
    RouterLink,
    Button,
    Callout,
    Cell,
    Control,
    DataTable,
    EmptyState,
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
      title="API keys"
      description="A shop’s webshop or ERP adds parcels with a key. Each key belongs to one shop and only sees its parcels."
    ></header>

    @if (error(); as error) {
      <os-callout tone="danger" title="The API keys didn’t load">{{ error }}</os-callout>
    }

    @if (keys() && merchants().length === 0) {
      <os-empty-state title="No shops yet">
        <p>A key belongs to a shop, so add a shop first.</p>
        <div><a os-button [routerLink]="['/n', network(), 'merchants']">Add a shop</a></div>
      </os-empty-state>
    } @else {
      <form
        os-setting-card
        title="Make a key"
        description="The key is shown once, so copy it into the shop’s system straight away."
        (ngSubmit)="create()"
      >
        <div os-setting-card-body class="fields">
          <os-field label="Shop">
            <select os-select name="merchant" required [(ngModel)]="merchantId">
              @for (m of merchants(); track m.id) {
                <option [value]="m.id">{{ m.name }}</option>
              }
            </select>
          </os-field>
          <os-field label="Name" hint="What uses it, e.g. Webshop.">
            <input #nameInput os-input name="name" required maxlength="120" [(ngModel)]="name" />
          </os-field>
        </div>
        <div os-setting-card-footer>
          <button os-button variant="primary" type="submit" [loading]="creating()">Make key</button>
        </div>
      </form>
    }

    @if (keys(); as keys) {
      @if (keys.length === 0) {
        @if (merchants().length > 0) {
          <os-empty-state title="No keys yet">
            <p>
              A key lets a shop’s own system, such as its webshop, add parcels. Make one when a shop
              asks for it.
            </p>
            <div><button os-button type="button" (click)="focusName()">Make key</button></div>
          </os-empty-state>
        }
      } @else {
        <os-data-table
          caption="API keys"
          [columns]="columns"
          [rows]="rows()"
          rowKey="id"
          empty="No keys yet."
        >
          <ng-template os-cell="name" let-k>
            {{ k.name }}<span class="os-cell-sub">{{ k.merchantName }}</span>
          </ng-template>
          <ng-template os-cell="hint" let-k
            ><code>{{ k.hint }}…</code></ng-template
          >
          <ng-template os-cell="lastUsedAt" let-k>
            <span class="nums">{{ k.lastUsedAt ? date(k.lastUsedAt) : 'Never' }}</span>
          </ng-template>
          <ng-template os-cell="actions" let-k>
            <button
              type="button"
              os-button
              size="sm"
              variant="ghost"
              tone="danger"
              (click)="remove(k)"
            >
              Delete
            </button>
          </ng-template>
        </os-data-table>
      }
    } @else if (loading.slow()) {
      <os-skeleton [lines]="3" />
    }

    <section
      os-setting-card
      title="Use it"
      description="Send the key as a Bearer token in the Authorization header."
    >
      <div os-setting-card-body>
        <pre><code>{{ example }}</code></pre>
        <p class="muted">
          <code>GET /api/v1/points?postcode=…&amp;city=…</code> lists the nearest open points for a
          checkout. <code>GET /api/v1/parcels/&#123;code&#125;</code> reads a parcel back.
        </p>
      </div>
    </section>
  `,
  styles: `
    p {
      margin: 0;
    }

    .fields {
      display: flex;
      flex-wrap: wrap;
      gap: var(--os-space-3);
      align-items: end;
    }

    pre {
      margin: 0;
      padding: var(--os-space-4);
      overflow-x: auto;
      border-radius: var(--os-radius-md);
      background: var(--os-bg-surface-200);
      font-size: var(--os-text-sm);
    }
  `,
})
export class ApiKeys {
  readonly network = input.required<string>();
  private readonly api = inject(Api);
  private readonly toaster = inject(Toaster);
  private readonly confirm = inject(ConfirmDialog);
  private readonly secret = inject(SecretDialog);
  private readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('nameInput');
  protected readonly keys = signal<ApiKey[] | null>(null);
  protected readonly merchants = signal<Merchant[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly creating = signal(false);
  protected readonly loading = slowLoading();
  protected readonly date = shortDate;
  protected merchantId = '';
  protected name = 'Webshop';
  private readonly key = new IdempotencyKey();
  protected readonly columns = [
    { key: 'name' as const, label: 'Key' },
    { key: 'hint' as const, label: 'Starts with' },
    { key: 'lastUsedAt' as const, label: 'Last used' },
    { key: 'actions' as const, label: 'Actions', align: 'end' as const },
  ];

  protected readonly rows = computed(() => (this.keys() ?? []).map((k) => ({ ...k, actions: '' })));

  /** Never the real key: the page only ever shows the placeholder. */
  protected readonly example = `curl ${location.origin}/api/v1/parcels \\
  -H "Authorization: Bearer rk_…" \\
  -H "Content-Type: application/json" \\
  -d '{"pointId": "…", "reference": "#1042",
       "customer": {"name": "Mia Jensen", "email": "mia@example.com", "postcode": "2200"}}'`;

  constructor() {
    effect(() => {
      void this.load(this.network());
    });
  }

  private get base(): string {
    return `/api/n/${encodeURIComponent(this.network())}`;
  }

  protected focusName(): void {
    const input = this.nameInput()?.nativeElement;
    input?.focus();
    input?.select();
  }

  protected async create(): Promise<void> {
    this.creating.set(true);
    this.error.set(null);
    try {
      const k = await this.api.post<NewApiKey>(
        `${this.base}/api-keys`,
        { name: this.name, merchantId: this.merchantId },
        this.key.value,
      );
      this.key.renew();
      this.keys.update((list) => [...(list ?? []), k]);
      await this.secret.show({
        title: `Your new key for ${k.merchantName}`,
        secret: k.key,
        what: 'API key',
        instructions: `Put it in ${k.merchantName}’s system as a Bearer token in the Authorization header. Only it can add parcels.`,
      });
    } catch (error) {
      this.error.set(errorText(error));
    } finally {
      this.creating.set(false);
    }
  }

  protected async remove(k: ApiKey): Promise<void> {
    const ok = await this.confirm.confirm({
      title: `Delete ${k.name} of ${k.merchantName}?`,
      message:
        'Whatever uses it can’t add or read parcels from then on. Parcels it already added stay, and you can make the shop a new key.',
      confirmLabel: 'Delete key',
      danger: true,
    });
    if (!ok) return;
    try {
      await this.api.delete(`${this.base}/api-keys/${k.id}`);
      this.keys.update((list) => list?.filter((x) => x.id !== k.id) ?? null);
    } catch (error) {
      this.toaster.show(errorText(error), { tone: 'danger' });
    }
  }

  private async load(network: string): Promise<void> {
    this.error.set(null);
    const base = `/api/n/${encodeURIComponent(network)}`;
    try {
      const [keys, merchants] = await this.loading.track(
        Promise.all([this.api.get<ApiKey[]>(`${base}/api-keys`), this.api.get<Merchant[]>(`${base}/merchants`)]),
      );
      if (network !== this.network()) return;
      this.keys.set(keys);
      this.merchants.set(merchants);
      this.merchantId ||= merchants[0]?.id ?? '';
    } catch (error) {
      this.error.set(errorText(error));
    }
  }
}
