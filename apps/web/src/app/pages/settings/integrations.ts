import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import type { Role } from '@open-relay/contracts';
import { allAnnounceGroups } from '@openstuff-dev/ui';
import { SectionHeader } from '@openstuff-dev/ui-angular';
import { Session } from '../../core/session';
import { ServerConnections } from './server-connections';

/**
 * Integrations. OpenRelay has only server connections for now, so only server admins see the
 * tab (the menu hides it from everyone else).
 */
@Component({
  selector: 'app-integrations',
  imports: [SectionHeader, ServerConnections],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'stack' },
  template: `
    <header
      os-section-header
      title="Integrations"
      description="Connect OpenRelay to the rest of OpenStuff. Each one is optional, and nothing changes until you paste the connection string it gives you."
    ></header>
    <app-server-connections tenant="network" [announceGroups]="groups()" />
  `,
})
export class Integrations {
  private readonly session = inject(Session);

  /** Every network a server admin can see, with every role: the groups to create. */
  protected readonly groups = computed(() =>
    allAnnounceGroups(this.session.me()?.networks.map((network) => network.slug) ?? [], ROLES),
  );
}

const ROLES: readonly Role[] = ['admin', 'merchant', 'courier', 'point'];
