import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Button, EmptyState } from '@openstuff-dev/ui-angular';
import { HOME, Session } from '../core/session';

/** `/` and `/n/:network`: straight to the page this person uses most. */
@Component({
  selector: 'app-start',
  imports: [RouterLink, Button, EmptyState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (session.me(); as me) {
      @if (me.isServerAdmin) {
        <os-empty-state title="Make your first network" [level]="1">
          A network has its own shops, pick-up points, couriers and parcels.
          <div os-actions>
            <a os-button variant="primary" routerLink="/settings/networks">Make a network</a>
          </div>
        </os-empty-state>
      } @else {
        <os-empty-state title="You’re not in a network yet" [level]="1">
          Ask an admin of your network to add you, then sign in again.
        </os-empty-state>
      }
    }
  `,
})
export class Start {
  protected readonly session = inject(Session);

  constructor() {
    const router = inject(Router);
    const slug = /^\/n\/([^/?#]+)/.exec(router.url)?.[1];
    const networks = this.session.me()?.networks ?? [];
    const target = networks.find((n) => n.slug === slug) ?? networks.at(0);
    if (target) void router.navigate(['/n', target.slug, HOME[target.role]], { replaceUrl: true });
  }
}
