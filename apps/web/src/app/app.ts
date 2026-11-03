import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Page } from '@openstuff-dev/ui-angular';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, Page],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main os-page>
      <router-outlet />
    </main>
  `,
})
export class App {}
