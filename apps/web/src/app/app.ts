import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ServerIntegrations } from './core/integrations';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<router-outlet />`,
})
export class App {
  constructor() {
    // OpenVersion and OpenAnnounce, when a server admin connected them. Nothing waits for it.
    inject(ServerIntegrations).start();
  }
}
