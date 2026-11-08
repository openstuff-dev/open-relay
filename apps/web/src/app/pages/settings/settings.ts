import { ChangeDetectionStrategy, Component, computed, effect, inject, input } from '@angular/core';
import { Router, RouterLinkActive, RouterLink } from '@angular/router';
import {
  NavLink,
  PageHeader,
  Settings,
  SettingsGroup,
  SettingsNav,
} from '@openstuff-dev/ui-angular';
import { Session } from '../../core/session';
import { Account } from './account';
import { Appearance } from './appearance';
import { ApiKeys } from './api-keys';
import { Data } from './data';
import { Members } from './members';
import { Networks } from './networks';
import {
  SETTINGS_TABS,
  type SettingsGroupKey,
  type SettingsTabId,
  type Who,
  isTabId,
  tabsFor,
} from './settings-tabs';

const GROUP_ORDER: readonly SettingsGroupKey[] = ['you', 'network', 'server'];

/**
 * Settings: one menu, one tab per page. Inside a network the address names it
 * (`/n/:network/settings/:tab`),
 * so a shared link opens the right one. Outside a network it's `/settings/:tab`.
 */
@Component({
  selector: 'app-settings',
  imports: [
    Account,
    Appearance,
    ApiKeys,
    Data,
    Members,
    Networks,
    NavLink,
    PageHeader,
    RouterLink,
    RouterLinkActive,
    Settings,
    SettingsGroup,
    SettingsNav,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'stack' },
  template: `
    <header
      os-page-header
      title="Settings"
      description="Your account, your preferences and, for admins, the network."
    ></header>

    <os-settings>
      <nav os-settings-nav label="Settings">
        @for (group of groups(); track group.key) {
          <os-settings-group [label]="group.label">
            @for (tab of group.tabs; track tab.id) {
              <a
                os-settings-link
                [icon]="tab.icon"
                [routerLink]="linkTo(tab.id)"
                routerLinkActive
                ariaCurrentWhenActive="page"
              >
                {{ tab.label }}
              </a>
            }
          </os-settings-group>
        }
      </nav>

      @if (allowed()) {
        @switch (tab()) {
          @case ('account') {
            <app-account />
          }
          @case ('appearance') {
            <app-appearance />
          }
          @case ('members') {
            <app-members [network]="network()" />
          }
          @case ('api-keys') {
            <app-api-keys [network]="network()" />
          }
          @case ('data') {
            <app-data [network]="network()" />
          }
          @case ('networks') {
            <app-networks />
          }
        }
      }
    </os-settings>
  `,
})
export class SettingsPage {
  /** From `settings/:tab`. */
  readonly tab = input<string>('account');
  /** From `n/:network/settings/:tab`. Empty outside a network. */
  readonly network = input<string>('');
  private readonly session = inject(Session);
  private readonly router = inject(Router);

  private readonly membership = computed(() => {
    const slug = this.network();
    return this.session.me()?.networks.find((n) => n.slug === slug) ?? null;
  });

  protected readonly who = computed<Who>(() => ({
    role: this.membership()?.role ?? null,
    isServerAdmin: this.session.me()?.isServerAdmin ?? false,
  }));

  protected readonly groups = computed(() => {
    const visible = tabsFor(this.who());
    const names: Record<SettingsGroupKey, string> = {
      you: 'You',
      network: this.membership()?.name ?? 'Network',
      server: 'Server',
    };
    return GROUP_ORDER.map((key) => ({
      key,
      label: names[key],
      tabs: visible.filter((tab) => tab.group === key),
    })).filter((group) => group.tabs.length > 0);
  });

  /** A tab this person can't use redirects to Account, and a tab that doesn't exist does too. */
  protected readonly allowed = computed(() => {
    const id = this.tab();
    return isTabId(id) && tabsFor(this.who()).some((tab) => tab.id === id);
  });

  constructor() {
    effect(() => {
      if (!this.allowed()) void this.router.navigate(this.linkTo('account'), { replaceUrl: true });
    });
  }

  /** Server tabs always live at `/settings/…`. The others sit in the network named in the URL. */
  protected linkTo(id: SettingsTabId): string[] {
    const network = this.network();
    const server = SETTINGS_TABS.find((tab) => tab.id === id)?.group === 'server';
    if (server || !network) return ['/settings', id];
    return ['/n', network, 'settings', id];
  }
}
