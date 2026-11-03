import { ChangeDetectionStrategy, Component, resource } from '@angular/core';
import { Button, Callout, PageHeader } from '@openstuff-dev/ui-angular';

@Component({
  selector: 'app-home',
  imports: [Button, Callout, PageHeader],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'stack' },
  template: `
    <header os-page-header title="Open Relay" description="A new OpenStuff app.">
      <a os-button variant="primary" href="https://github.com/openstuff-dev/design">Toolkit docs</a>
    </header>
    <os-callout tone="success" title="It works">
      Edit <code>src/app/home.ts</code> to change this page. The theme comes from
      <code>primaryColor</code> in <code>tokens.config.json</code>.
    </os-callout>
    @if (health.hasValue()) {
      <os-callout tone="info" title="The server answers">
        <code>/api/health</code> says {{ health.value().status }}.
      </os-callout>
    } @else if (health.error()) {
      <os-callout tone="warning" title="The server doesn't answer">
        Start it with <code>npx nx dev server</code>.
      </os-callout>
    }
  `,
})
export class Home {
  protected readonly health = resource({
    loader: async () => {
      const response = await fetch('/api/health');
      if (!response.ok) throw new Error(`Health check failed: ${response.status}`);
      return (await response.json()) as { status: string };
    },
  });
}
