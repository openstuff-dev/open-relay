import { ChangeDetectionStrategy, Component } from '@angular/core';
import { SectionHeader } from '@openstuff-dev/ui-angular';
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
      description="Connect other OpenStuff apps. Paste the connection string they give you, and OpenRelay tests it straight away."
    ></header>
    <app-server-connections />
  `,
})
export class Integrations {}
