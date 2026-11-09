import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type { Merchant, MerchantInput } from '@open-relay/contracts';
import {
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
  Toaster,
} from '@openstuff-dev/ui-angular';
import { Api, errorText } from '../core/api';
import { IdempotencyKey } from '../core/idempotency';
import { iconPlus } from '../shared/icons';

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

/** The online shops that send parcels through this network. */
@Component({
  selector: 'app-merchants',
  imports: [
    FormsModule,
    RouterLink,
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
    <header
      os-page-header
      title="Shops"
      description="The online shops that send parcels. Add their staff under Members, or give them an API key."
    >
      <button type="button" os-button variant="primary" (click)="edit(null)">
        <svg os-icon [icon]="iconPlus" size="sm"></svg>New shop
      </button>
    </header>
    @if (error(); as error) {
      <os-callout tone="danger" title="The shops didn’t load">{{ error }}</os-callout>
    }
    @if (merchants(); as merchants) {
      <os-data-table
        caption="Shops"
        [columns]="columns"
        [rows]="merchants"
        rowKey="id"
        empty="No shops yet."
      >
        <ng-template os-cell="name" let-m>
          <button type="button" os-button variant="link" (click)="edit(m)">{{ m.name }}</button>
          @if (m.email) {
            <span class="os-cell-sub">{{ m.email }}</span>
          }
        </ng-template>
        <ng-template os-cell="parcelCount" let-m>
          <a
            class="nums"
            [routerLink]="['/n', network(), 'parcels']"
            [queryParams]="{ merchantId: m.id }"
            >{{ m.parcelCount }}</a
          >
        </ng-template>
      </os-data-table>
    } @else if (loading.slow()) {
      <os-skeleton [lines]="4" />
    }

    <dialog os-dialog size="sm" [(open)]="open">
      <header os-dialog-header>
        <h2 os-dialog-title>{{ id ? 'Edit ' + form.name : 'New shop' }}</h2>
      </header>
      <form id="merchant-form" os-dialog-body class="stack" (ngSubmit)="save()">
        @if (saveError(); as e) {
          <os-callout tone="danger">{{ e }}</os-callout>
        }
        <os-field label="Name">
          <input os-input name="name" required maxlength="120" [(ngModel)]="form.name" />
        </os-field>
        <os-field label="Pickup address" hint="Where couriers collect the parcels.">
          <input os-input name="address" maxlength="300" [(ngModel)]="form.address" />
        </os-field>
        <os-field label="Contact email (optional)">
          <input os-input type="email" name="email" [(ngModel)]="form.email" />
        </os-field>
      </form>
      <footer os-dialog-footer>
        @if (id) {
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
        <button os-button variant="primary" type="submit" form="merchant-form" [loading]="saving()">
          Save
        </button>
      </footer>
    </dialog>
  `,
  styles: `
    .start {
      margin-inline-end: auto;
    }
  `,
})
export class Merchants {
  readonly network = input.required<string>();
  private readonly api = inject(Api);
  private readonly toaster = inject(Toaster);
  private readonly confirm = inject(ConfirmDialog);
  protected readonly merchants = signal<Merchant[] | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly loading = slowLoading();
  protected readonly iconPlus = iconPlus;
  protected readonly columns = [
    { key: 'name' as const, label: 'Shop' },
    { key: 'address' as const, label: 'Pickup address' },
    { key: 'parcelCount' as const, label: 'Open parcels', align: 'end' as const },
  ];

  protected readonly open = signal(false);
  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);
  protected id: string | null = null;
  protected form: MerchantInput = { name: '', address: '', email: '' };
  private readonly key = new IdempotencyKey();

  constructor() {
    effect(() => {
      void this.load(this.network());
    });
    inject(DestroyRef).onDestroy(onReturn(() => void this.load(this.network())));
  }

  private get base(): string {
    return `/api/n/${encodeURIComponent(this.network())}/merchants`;
  }

  protected edit(m: Merchant | null): void {
    this.saveError.set(null);
    this.id = m?.id ?? null;
    this.form = { name: m?.name ?? '', address: m?.address ?? '', email: m?.email ?? '' };
    this.open.set(true);
  }

  protected async save(): Promise<void> {
    this.saving.set(true);
    this.saveError.set(null);
    const body = { ...this.form, email: this.form.email || null };
    try {
      const saved = this.id
        ? await this.api.patch<Merchant>(`${this.base}/${this.id}`, body)
        : await this.api.post<Merchant>(this.base, body, this.key.value);
      if (!this.id) this.key.renew();
      this.merchants.update((list) =>
        [...(list ?? []).filter((m) => m.id !== saved.id), saved].sort(byName),
      );
      this.open.set(false);
      this.toaster.show(`Saved ${saved.name}.`, { tone: 'success' });
    } catch (error) {
      this.saveError.set(errorText(error));
    } finally {
      this.saving.set(false);
    }
  }

  protected async remove(): Promise<void> {
    const id = this.id;
    if (!id) return;
    const ok = await this.confirm.confirm({
      title: `Delete ${this.form.name}?`,
      message: 'Only shops that never sent a parcel can be deleted. Their staff lose access.',
      confirmLabel: 'Delete shop',
      danger: true,
    });
    if (!ok) return;
    try {
      await this.api.delete(`${this.base}/${id}`);
      this.merchants.update((list) => list?.filter((m) => m.id !== id) ?? null);
      this.open.set(false);
    } catch (error) {
      this.saveError.set(errorText(error));
    }
  }

  private async load(network: string): Promise<void> {
    this.error.set(null);
    try {
      const merchants = await this.loading.track(
        this.api.get<Merchant[]>(`/api/n/${encodeURIComponent(network)}/merchants`, {
          onFresh: (fresh) => { if (network === this.network()) this.merchants.set(fresh); },
        }),
      );
      if (network === this.network()) this.merchants.set(merchants);
    } catch (error) {
      this.error.set(errorText(error));
    }
  }
}
