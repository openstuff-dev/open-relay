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
import { Router, RouterLink } from '@angular/router';
import {
  type ParcelRow,
  type ParcelStatus,
  type Role,
  type ScanRefused,
  type ScanResult,
  normaliseCode,
} from '@open-relay/contracts';
import { Badge, Button, Callout, Control, Field, Icon, PageHeader, Toaster } from '@openstuff-dev/ui-angular';
import { Api, ApiError } from '../core/api';
import { Session } from '../core/session';
import { iconUndo } from '../shared/icons';
import { STATUS_LABELS, STATUS_TONES, code } from '../shared/labels';
import { Scanner } from '../shared/scanner';

const WHAT_YOU_DO: Record<Role, string> = {
  admin: 'Scan a label to move the parcel to its next step.',
  merchant: 'Scan a label when the parcel is packed, so a courier comes for it.',
  courier: 'Scan each label as you take the parcel from the shop.',
  point: 'Scan a label when a parcel arrives, and again with the customer’s code to hand it over.',
};

const DONE: Partial<Record<ParcelStatus, string>> = {
  ready: 'Ready for a courier',
  in_transit: 'Picked up',
  at_point: 'Arrived: the customer has been emailed',
  collected: 'Handed over to the customer',
};

interface Done {
  result: ScanResult;
  undone: boolean;
}

/** One screen for every role: point the camera at a label (or type its code) and it's done. */
@Component({
  selector: 'app-scan',
  imports: [
    FormsModule,
    RouterLink,
    Badge,
    Button,
    Callout,
    Control,
    Field,
    Icon,
    PageHeader,
    Scanner,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'stack' },
  template: `
    <header os-page-header title="Scan" [description]="description()"></header>

    <div class="layout">
      <app-scanner (scanned)="fromCamera($event)" />

      <div class="stack">
        @if (waitingFor(); as parcel) {
          <form class="stack pickup" (ngSubmit)="submitPickup()">
            <os-callout tone="info" title="Ask for the pickup code">
              {{ parcel.customerName ?? 'The customer' }} has a 6-digit code in their email. Scan
              its QR code or type it.
            </os-callout>
            <os-field label="Pickup code" [error]="pickupError()">
              <input
                #pickupInput
                os-input
                name="pickupCode"
                inputmode="numeric"
                autocomplete="one-time-code"
                pattern="[0-9]{6}"
                maxlength="6"
                required
                class="big code"
                [(ngModel)]="pickupCode"
              />
            </os-field>
            <div class="inline">
              <button os-button variant="primary" type="submit" [loading]="busy()">
                Hand over
              </button>
              <button os-button type="button" (click)="cancelPickup()">Not now</button>
            </div>
          </form>
        } @else {
          <form class="stack" (ngSubmit)="submitTyped()">
            <os-field
              label="Parcel code"
              hint="Type the code under the QR code, or use a handheld scanner."
              [error]="typedError()"
            >
              <input
                #codeInput
                os-input
                name="code"
                autocapitalize="characters"
                autocomplete="off"
                spellcheck="false"
                placeholder="7K3M-Q9XD"
                class="big code"
                [(ngModel)]="typed"
              />
            </os-field>
            <div>
              <button os-button variant="primary" type="submit" [loading]="busy()">Scan</button>
            </div>
          </form>
        }

        <div aria-live="polite" class="stack">
          @if (refused(); as refused) {
            <os-callout tone="warning" [title]="refused.error">
              @if (refused.parcel; as p) {
                <span class="code">{{ fmt(p.code) }}</span> · {{ p.merchant.name }} →
                {{ p.point.name }} · {{ statusLabels[p.status] }}
              }
            </os-callout>
          }
          @if (last(); as done) {
            <article class="result" [class.undone]="done.undone">
              <p class="headline">
                {{ done.undone ? 'Undone' : doneLabel(done.result.to) }}
              </p>
              <p>
                <span class="code">{{ fmt(done.result.parcel.code) }}</span>
                <span os-badge [tone]="tones[done.undone ? done.result.from : done.result.to]">{{
                  statusLabels[done.undone ? done.result.from : done.result.to]
                }}</span>
              </p>
              <p class="muted">
                {{ done.result.parcel.merchant.name }} → {{ done.result.parcel.point.name }}
                @if (done.result.parcel.customerName) {
                  · {{ done.result.parcel.customerName }}
                }
              </p>
              @if (!done.undone) {
                <div class="inline">
                  <button os-button type="button" size="sm" (click)="undo(done)">
                    <svg os-icon [icon]="iconUndo" size="sm"></svg>Undo
                  </button>
                  @if (canOpen()) {
                    <a
                      os-button
                      variant="ghost"
                      size="sm"
                      [routerLink]="['/n', network(), 'parcels', done.result.parcel.id]"
                      >Open parcel</a
                    >
                  }
                </div>
              }
            </article>
          }
        </div>

        @if (history().length > 1) {
          <section class="stack">
            <h2>Scanned here</h2>
            <ol class="history">
              @for (h of history().slice(1); track h.result.scanId) {
                <li [class.undone]="h.undone">
                  <span class="code">{{ fmt(h.result.parcel.code) }}</span>
                  <span class="muted">{{ h.undone ? 'Undone' : statusLabels[h.result.to] }}</span>
                </li>
              }
            </ol>
          </section>
        }
      </div>
    </div>
  `,
  styles: `
    :host {
      container-type: inline-size;
    }

    .layout {
      display: grid;
      gap: var(--os-space-6);
      align-items: start;
    }

    @container (inline-size > 48rem) {
      .layout {
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      }
    }

    .big {
      font-size: var(--os-text-xl);
      block-size: 3rem;
    }

    .result {
      display: grid;
      gap: var(--os-space-2);
      padding: var(--os-space-4);
      border: 1px var(--os-border-style) var(--os-success-border);
      border-radius: var(--os-radius-lg);
      background: var(--os-success-soft);
    }

    .result.undone {
      border-color: var(--os-border-default);
      background: var(--os-bg-surface-100);
    }

    .result p {
      display: flex;
      flex-wrap: wrap;
      gap: var(--os-space-2);
      align-items: center;
      margin: 0;
    }

    .headline {
      font-size: var(--os-text-xl);
      font-weight: var(--os-font-weight-semibold);
      text-wrap: balance;
    }

    h2 {
      margin: 0;
      font-size: var(--os-text-md);
    }

    .history {
      display: grid;
      gap: var(--os-space-2);
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .history li {
      display: flex;
      gap: var(--os-space-3);
      justify-content: space-between;
    }

    .history .undone .code {
      text-decoration: line-through;
    }
  `,
})
export class Scan {
  /** From /n/:network/scan; empty for /s/:code, which picks the network. */
  readonly network = input<string | undefined>();
  /** From /s/:code or ?code=…: scanned as soon as the page opens. */
  readonly code = input<string>();

  private readonly api = inject(Api);
  private readonly router = inject(Router);
  private readonly toaster = inject(Toaster);
  private readonly session = inject(Session);
  private readonly codeInput = viewChild<ElementRef<HTMLInputElement>>('codeInput');
  private readonly pickupInput = viewChild<ElementRef<HTMLInputElement>>('pickupInput');

  protected readonly statusLabels = STATUS_LABELS;
  protected readonly tones = STATUS_TONES;
  protected readonly iconUndo = iconUndo;
  protected readonly fmt = code;
  protected typed = '';
  protected pickupCode = '';
  protected readonly busy = signal(false);
  protected readonly typedError = signal<string | null>(null);
  protected readonly pickupError = signal<string | null>(null);
  protected readonly refused = signal<ScanRefused | null>(null);
  /** The parcel being handed over, waiting for the customer's code. */
  protected readonly waitingFor = signal<ParcelRow | null>(null);
  protected readonly history = signal<Done[]>([]);
  protected readonly last = computed(() => this.history().at(0) ?? null);
  protected readonly description = computed(() => WHAT_YOU_DO[this.session.role() ?? 'admin']);
  protected readonly canOpen = computed(() => this.session.role() !== 'courier');
  private started = false;

  constructor() {
    effect(() => {
      const raw = this.code();
      if (this.started || !raw) return;
      this.started = true;
      if (!this.network()) {
        // /s/:code from a phone camera: use the network this person is looking at, or their first.
        const slug = this.session.network() ?? this.session.me()?.networks[0]?.slug;
        if (slug) void this.router.navigate(['/n', slug, 'scan'], { queryParams: { code: raw }, replaceUrl: true });
        return;
      }
      void this.scan(raw);
      // Drop ?code= so a reload doesn't scan the label again.
      void this.router.navigate([], { queryParams: { code: null }, replaceUrl: true });
    });
    effect(() => {
      // Keep the cursor where the next code goes, for handheld scanners.
      (this.waitingFor() ? this.pickupInput() : this.codeInput())?.nativeElement.focus();
    });
  }

  protected doneLabel(to: ParcelStatus): string {
    return DONE[to] ?? STATUS_LABELS[to];
  }

  protected fromCamera(value: string): void {
    const waiting = this.waitingFor();
    if (waiting && /^\d{6}$/.test(value.trim())) {
      this.pickupCode = value.trim();
      void this.scan(waiting.code, this.pickupCode);
      return;
    }
    void this.scan(value);
  }

  protected submitTyped(): void {
    const raw = this.typed;
    if (!normaliseCode(raw)) {
      this.typedError.set('That isn’t a parcel code. They look like 7K3M-Q9XD.');
      return;
    }
    void this.scan(raw);
  }

  protected submitPickup(): void {
    const parcel = this.waitingFor();
    if (!parcel) return;
    if (!/^\d{6}$/.test(this.pickupCode.trim())) {
      this.pickupError.set('The pickup code has 6 digits.');
      return;
    }
    void this.scan(parcel.code, this.pickupCode.trim());
  }

  protected cancelPickup(): void {
    this.waitingFor.set(null);
    this.pickupCode = '';
    this.pickupError.set(null);
  }

  protected async undo(done: Done): Promise<void> {
    // Shown at once; put back if the server says no.
    const mark = (undone: boolean) => {
      const id = done.result.scanId;
      const set = (d: Done) => (d.result.scanId === id ? { ...d, undone } : d);
      this.history.update((list) => list.map(set));
    };
    mark(true);
    try {
      await this.api.post(`${this.base}/scans/${done.result.scanId}/undo`);
      this.toaster.show(`Undone: ${code(done.result.parcel.code)} is ${STATUS_LABELS[done.result.from].toLowerCase()} again.`);
    } catch (error) {
      mark(false);
      this.toaster.show(error instanceof Error ? error.message : 'That couldn’t be undone.', { tone: 'danger' });
    }
  }

  private get base(): string {
    return `/api/n/${encodeURIComponent(this.network() ?? '')}`;
  }

  private async scan(raw: string, pickupCode?: string): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.typedError.set(null);
    this.pickupError.set(null);
    this.refused.set(null);
    try {
      const result = await this.api.post<ScanResult>(`${this.base}/scan`, { code: raw, pickupCode });
      this.history.update((list) => [{ result, undone: false }, ...list].slice(0, 20));
      this.typed = '';
      this.cancelPickup();
    } catch (error) {
      const body = error instanceof ApiError ? (error.body as ScanRefused | undefined) : undefined;
      if (body?.needsPickupCode && body.parcel) {
        this.waitingFor.set(body.parcel);
        if (pickupCode) this.pickupError.set(body.error);
      } else {
        this.refused.set({ error: error instanceof Error ? error.message : 'That didn’t work.', parcel: body?.parcel });
        this.cancelPickup();
        // Ready for the next code from a handheld scanner.
        this.typed = '';
      }
    } finally {
      this.busy.set(false);
    }
  }
}
