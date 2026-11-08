import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import {
  Button,
  Callout,
  FileInput,
  Field,
  SectionHeader,
  SettingCard,
  SettingCardFooter,
} from '@openstuff-dev/ui-angular';
import { Api, errorText } from '../../core/api';

interface ImportResult {
  merchants: number;
  points: number;
  parcels: number;
  skipped: number;
}

/** Everything in this network as one JSON file, and back again. */
@Component({
  selector: 'app-data',
  imports: [Button, Callout, Field, FileInput, SectionHeader, SettingCard, SettingCardFooter],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'stack' },
  template: `
    <header
      os-section-header
      title="Export and import"
      description="Your data is yours. Keep a copy, or move it to another OpenRelay server. API keys and pickup codes aren’t in the file."
    ></header>

    <section
      os-setting-card
      title="Export"
      description="This network’s shops, pick-up points and parcels, with each parcel’s history."
    >
      <div os-setting-card-footer>
        <a os-button variant="primary" [href]="exportUrl()" download>Download export</a>
      </div>
    </section>

    <section
      os-setting-card
      title="Import"
      description="Adds what’s in an export file to this network. Shops and points with the same slug are updated. Parcels already on this server are skipped; the others get new tracking links and pickup codes, and no emails go out."
    >
      <os-field label="Export file">
        <input
          type="file"
          os-file-input
          accept="application/json,.json"
          (change)="pick($event)"
          [disabled]="busy()"
        />
      </os-field>
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
      this.result.set(
        await this.api.post<ImportResult>(`/api/n/${encodeURIComponent(this.network())}/import`, data),
      );
    } catch (error) {
      this.error.set(errorText(error));
    } finally {
      this.busy.set(false);
      input.value = '';
    }
  }
}
