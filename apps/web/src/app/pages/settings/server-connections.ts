import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import {
  Callout,
  type ServerConnection,
  ServerConnectionCard,
  type ServerConnectionsClient,
  Skeleton,
} from '@openstuff-dev/ui-angular';
import { Api, errorText } from '../../core/api';
import { slowLoading } from '../../core/loading';

/**
 * "This server" on Integrations, for server admins: the connections to OpenVersion and
 * OpenAnnounce that `@openstuff-dev/server` offers. The card does the work; this loads the list
 * and hands the card this app's API service. The same file is in every app.
 */
@Component({
  selector: 'app-server-connections',
  imports: [Callout, ServerConnectionCard, Skeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'stack' },
  template: `
    <hgroup class="server-connections-head">
      <h2>This server</h2>
      <p>Only server admins see these. They apply to everyone on this server.</p>
    </hgroup>
    @if (error(); as error) {
      <os-callout tone="danger" title="The connections didn’t load">{{ error }}</os-callout>
    }
    @if (connections(); as connections) {
      @for (connection of connections; track connection.kind) {
        <os-server-connection-card [connection]="connection" [client]="client" />
      }
    } @else if (loading.slow()) {
      <os-skeleton [lines]="4" />
    }
  `,
  styles: `
    .server-connections-head {
      display: grid;
      gap: var(--os-space-1);
      margin: 0;

      & h2 {
        font-size: var(--os-text-md);
      }

      & p {
        margin: 0;
        color: var(--os-fg-light);
        font-size: var(--os-text-sm);
      }
    }
  `,
})
export class ServerConnections {
  private readonly api = inject(Api);
  protected readonly connections = signal<ServerConnection[] | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly loading = slowLoading();

  protected readonly client: ServerConnectionsClient = {
    save: (kind, body) => this.api.put(`/api/admin/integrations/${kind}`, body),
    test: (kind) => this.api.post(`/api/admin/integrations/${kind}/test`, {}),
    remove: async (kind) => {
      await this.api.delete(`/api/admin/integrations/${kind}`);
    },
  };

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const path = '/api/admin/integrations';
      this.connections.set(await this.loading.track(this.api.get<ServerConnection[]>(path)));
    } catch (error) {
      this.error.set(errorText(error));
    }
  }
}
