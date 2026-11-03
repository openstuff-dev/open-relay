import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { Button, Callout, PageHeader } from '@openstuff-dev/ui-angular';
import { Api, errorText } from '../core/api';

interface ImportResult {
  merchants: number;
  points: number;
  parcels: number;
  skipped: number;
}

/** Everything in this network as one JSON file, and back again. */
@Component({
  selector: 'app-data',
  imports: [Button, Callout, PageHeader],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'stack' },
  template: `
    <header
      os-page-header
      title="Export and import"
      description="Your data is yours: take it to another OpenRelay server, or keep a copy."
    ></header>

    <section class="stack">
      <h2>Export</h2>
      <p>
        One JSON file with this network’s shops, pick-up points and parcels, with each parcel’s
        history. API keys and pickup codes aren’t in it.
      </p>
      <div><a os-button variant="primary" [href]="exportUrl()" download>Download export</a></div>
    </section>

    <section class="stack">
      <h2>Import</h2>
      <p>
        Adds what’s in an export file to this network. Shops and points with the same slug are
        updated. Parcels already on this server are skipped; the others get new tracking links and
        pickup codes, and no emails go out.
      </p>
      <label class="file">
        <span class="os-visually-hidden">Export file</span>
        <input
          type="file"
          accept="application/json,.json"
          (change)="pick($event)"
          [disabled]="busy()"
        />
      </label>
      @if (result(); as r) {
        <os-callout tone="success" title="Imported">
          {{ r.merchants }} shops, {{ r.points }} pick-up points and {{ r.parcels }} parcels.
          @if (r.skipped) {
            {{ r.skipped }} parcels were on this server already, so they were skipped.
          }
        </os-callout>
      }
      @if (error(); as error) {
        <os-callout tone="danger" title="Nothing was imported">{{ error }}</os-callout>
      }
    </section>
  `,
  styles: `
    h2 {
      margin: 0;
      font-size: var(--os-text-lg);
    }

    p {
      max-inline-size: 60ch;
      margin: 0;
      text-wrap: pretty;
    }
  `,
})
export class Data {
  readonly network = input.required<string>();
  private readonly api = inject(Api);
  protected readonly busy = signal(false);
  protected readonly result = signal<ImportResult | null>(null);
  protected readonly error = signal<string | null>(null);

  protected exportUrl(): string {
    return `/api/n/${encodeURIComponent(this.network())}/export`;
  }

  protected async pick(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.busy.set(true);
    this.result.set(null);
    this.error.set(null);
    try {
      let data: unknown;
      try {
        data = JSON.parse(await file.text());
      } catch {
        throw new Error('That file isn’t JSON. Choose a file you exported from OpenRelay.');
      }
      this.result.set(await this.api.post<ImportResult>(`/api/n/${encodeURIComponent(this.network())}/import`, data));
    } catch (error) {
      this.error.set(errorText(error));
    } finally {
      this.busy.set(false);
      input.value = '';
    }
  }
}
