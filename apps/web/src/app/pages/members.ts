import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { Member, MembersPage, NewMember, Role } from '@open-relay/contracts';
import {
  Button,
  Callout,
  Cell,
  ConfirmDialog,
  Control,
  DataTable,
  Field,
  PageHeader,
  Skeleton,
  Toaster,
} from '@openstuff-dev/ui-angular';
import { Api, errorText } from '../core/api';
import { IdempotencyKey } from '../core/idempotency';
import { onReturn, slowLoading } from '../core/loading';
import { Session } from '../core/session';
import { CopyButton } from '../shared/copy-button';
import { ROLE_LABELS } from '../shared/labels';

const ROLES: Role[] = ['merchant', 'courier', 'point', 'admin'];

/** Who signs in to this network, and what they do there. */
@Component({
  selector: 'app-members',
  imports: [
    FormsModule,
    Button,
    Callout,
    Cell,
    Control,
    CopyButton,
    DataTable,
    Field,
    PageHeader,
    Skeleton,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'stack' },
  template: `
    <header
      os-page-header
      title="Members"
      description="Shop staff add parcels for their shop. Couriers pick them up. Point staff receive them and hand them over. Admins manage everything."
    ></header>

    @if (error(); as error) {
      <os-callout tone="danger" title="The members didn’t load">{{ error }}</os-callout>
    }

    <form class="inline" (ngSubmit)="add()">
      <os-field label="Email" [error]="addError()">
        <input os-input type="email" name="email" required [(ngModel)]="email" />
      </os-field>
      <os-field label="Name (optional)">
        <input os-input name="name" [(ngModel)]="name" />
      </os-field>
      <os-field label="Role">
        <select os-select name="role" [(ngModel)]="role">
          @for (r of roles; track r) {
            <option [value]="r">{{ roleLabels[r] }}</option>
          }
        </select>
      </os-field>
      @if (role === 'merchant') {
        <os-field label="Shop">
          <select os-select name="merchantId" required [(ngModel)]="merchantId">
            @for (m of merchants(); track m.id) {
              <option [value]="m.id">{{ m.name }}</option>
            }
          </select>
        </os-field>
      }
      @if (role === 'point') {
        <os-field label="Pick-up point">
          <select os-select name="pointId" required [(ngModel)]="pointId">
            @for (p of points(); track p.id) {
              <option [value]="p.id">{{ p.name }}</option>
            }
          </select>
        </os-field>
      }
      <button os-button type="submit" [loading]="adding()">Add member</button>
    </form>

    @if (newPassword(); as added) {
      <os-callout tone="info" title="Send {{ added.email }} their password">
        <p>
          This is the only time it’s shown: <code>{{ added.password }}</code>
          <app-copy-button [text]="added.password ?? ''" what="password" />
        </p>
      </os-callout>
    }

    @if (members(); as members) {
      <os-data-table
        caption="Members"
        [columns]="columns"
        [rows]="rows(members)"
        rowKey="accountId"
      >
        <ng-template os-cell="name" let-m>
          {{ m.name || m.email }}
          @if (m.name) {
            <span class="os-cell-sub">{{ m.email }}</span>
          }
        </ng-template>
        <ng-template os-cell="role" let-m>
          {{ roleLabels[asRole(m.role)] }}{{ m.accountId === me() ? ' (you)' : '' }}
        </ng-template>
        <ng-template os-cell="at" let-m>{{ placeOf(m) }}</ng-template>
        <ng-template os-cell="actions" let-m>
          @if (m.accountId !== me()) {
            <button
              type="button"
              os-button
              variant="ghost"
              tone="danger"
              size="sm"
              (click)="remove(m)"
            >
              Remove
            </button>
          }
        </ng-template>
      </os-data-table>
    } @else if (loading.slow()) {
      <os-skeleton [lines]="5" />
    }
  `,
})
export class Members {
  readonly network = input.required<string>();
  private readonly api = inject(Api);
  private readonly toaster = inject(Toaster);
  private readonly confirm = inject(ConfirmDialog);
  private readonly session = inject(Session);
  protected readonly me = () => this.session.me()?.id;
  protected readonly members = signal<Member[] | null>(null);
  protected readonly merchants = signal<MembersPage['merchants']>([]);
  protected readonly points = signal<MembersPage['points']>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly loading = slowLoading();
  protected readonly roles = ROLES;
  protected readonly roleLabels = ROLE_LABELS;
  protected readonly asRole = (r: string) => r as Role;
  protected readonly columns = [
    { key: 'name' as const, label: 'Member' },
    { key: 'role' as const, label: 'Role' },
    { key: 'at' as const, label: 'Works at' },
    { key: 'actions' as const, label: 'Actions', align: 'end' as const },
  ];

  protected rows = (members: Member[]) => members.map((m) => ({ ...m, at: '', actions: '' }));
  protected email = '';
  protected name = '';
  protected role: Role = 'merchant';
  protected merchantId = '';
  protected pointId = '';
  protected readonly adding = signal(false);
  protected readonly addError = signal<string | null>(null);
  protected readonly newPassword = signal<NewMember | null>(null);
  private readonly key = new IdempotencyKey();

  constructor() {
    effect(() => {
      void this.load(this.network());
    });
    inject(DestroyRef).onDestroy(onReturn(() => void this.load(this.network())));
  }

  private get base(): string {
    return `/api/n/${encodeURIComponent(this.network())}`;
  }

  protected placeOf(m: Member): string {
    if (m.merchantId) return this.merchants().find((x) => x.id === m.merchantId)?.name ?? '';
    if (m.pointId) return this.points().find((x) => x.id === m.pointId)?.name ?? '';
    return '—';
  }

  protected async add(): Promise<void> {
    this.adding.set(true);
    this.addError.set(null);
    this.newPassword.set(null);
    try {
      const body = {
        email: this.email,
        name: this.name,
        role: this.role,
        merchantId: this.role === 'merchant' ? this.merchantId : null,
        pointId: this.role === 'point' ? this.pointId : null,
      };
      const added = await this.api.post<NewMember>(`${this.base}/members`, body, this.key.value);
      this.key.renew();
      this.email = '';
      this.name = '';
      this.members.update((m) => (m ? [...m, added] : m));
      if (added.password) this.newPassword.set(added);
      else this.toaster.show(`Added ${added.email}. They sign in with the password they have.`, { tone: 'success' });
    } catch (error) {
      this.addError.set(errorText(error));
    } finally {
      this.adding.set(false);
    }
  }

  protected async remove(member: Member): Promise<void> {
    const ok = await this.confirm.confirm({
      title: `Remove ${member.name || member.email}?`,
      message: 'They lose access to this network at once. Their account stays, and you can add them again.',
      confirmLabel: 'Remove member',
      danger: true,
    });
    if (!ok) return;
    try {
      await this.api.delete(`${this.base}/members/${member.accountId}`);
      this.members.update((m) => m?.filter((x) => x.accountId !== member.accountId) ?? null);
    } catch (error) {
      this.toaster.show(errorText(error), { tone: 'danger' });
    }
  }

  private async load(network: string): Promise<void> {
    this.error.set(null);
    try {
      const { members, merchants, points } = await this.loading.track(
        this.api.get<MembersPage>(`/api/n/${encodeURIComponent(network)}/members`),
      );
      if (network !== this.network()) return;
      this.members.set(members);
      this.merchants.set(merchants);
      this.points.set(points);
      this.merchantId ||= merchants[0]?.id ?? '';
      this.pointId ||= points[0]?.id ?? '';
    } catch (error) {
      this.error.set(errorText(error));
    }
  }
}
