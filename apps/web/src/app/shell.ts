import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { FormsModule } from '@angular/forms';
import {
  Button,
  Callout,
  Control,
  Dialog,
  DialogBody,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Icon,
  IconButton,
  Page,
  Toaster,
} from '@openstuff-dev/ui-angular';
import { Api, errorText } from './core/api';
import { Session } from './core/session';
import type { Role } from '@open-relay/contracts';
import {
  iconData,
  iconKeys,
  iconMembers,
  iconMenu,
  iconMerchants,
  iconNetworks,
  iconParcels,
  iconPickups,
  iconPoints,
  iconScan,
  iconSignOut,
} from './shared/icons';
import { ROLE_LABELS } from './shared/labels';

type IconNode = typeof iconParcels;
interface NavLink {
  path: string;
  label: string;
  icon: IconNode;
  roles: readonly Role[];
}

/** The pages in the sidebar, and who sees each. */
const LINKS: NavLink[] = [
  { path: 'scan', label: 'Scan', icon: iconScan, roles: ['admin', 'merchant', 'courier', 'point'] },
  { path: 'parcels', label: 'Parcels', icon: iconParcels, roles: ['admin', 'merchant', 'point'] },
  { path: 'pickups', label: 'Pickups', icon: iconPickups, roles: ['admin', 'courier'] },
  { path: 'points', label: 'Pick-up points', icon: iconPoints, roles: ['admin'] },
  { path: 'merchants', label: 'Shops', icon: iconMerchants, roles: ['admin'] },
  { path: 'members', label: 'Members', icon: iconMembers, roles: ['admin'] },
  { path: 'api-keys', label: 'API keys', icon: iconKeys, roles: ['admin'] },
  { path: 'data', label: 'Export and import', icon: iconData, roles: ['admin'] },
];

/** The frame around every signed-in page: the sidebar, the network switch and the topbar. */
@Component({
  selector: 'app-shell',
  imports: [
    FormsModule,
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    Button,
    Callout,
    Control,
    Dialog,
    DialogBody,
    DialogClose,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Field,
    Icon,
    IconButton,
    Page,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="os-shell" [attr.data-open]="menuOpen() ? '' : null">
      <nav class="os-shell-sidebar" id="sidebar" aria-label="Main">
        <a class="os-shell-brand" routerLink="/">
          <!-- The OpenStuff ring with OpenRelay's diamond, as on relay.openstuff.dev. -->
          <svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
            <path
              class="ring"
              fill-rule="evenodd"
              d="M16 1.5a14.5 14.5 0 1 0 0 29a14.5 14.5 0 1 0 0-29Zm0 4a10.5 10.5 0 1 1 0 21a10.5 10.5 0 1 1 0-21Z"
            />
            <path class="glyph" d="M16 10.2L21.8 16L16 21.8L10.2 16Z" />
          </svg>
          OpenRelay
        </a>

        @if (me(); as me) {
          @if (me.networks.length > 1 || me.isServerAdmin) {
            <label class="network-switch">
              <span class="os-visually-hidden">Network</span>
              <select class="os-select" [value]="network() ?? ''" (change)="switchNetwork($event)">
                @if (!network()) {
                  <option value="" disabled>Choose a network</option>
                }
                @for (n of me.networks; track n.slug) {
                  <option [value]="n.slug">{{ n.name }}</option>
                }
              </select>
            </label>
          } @else if (me.networks[0]; as only) {
            <p class="network-name">{{ only.name }}</p>
          }
        }

        @if (network(); as n) {
          @for (link of links(); track link.path) {
            <a
              class="nav-link"
              [routerLink]="['/n', n, link.path]"
              routerLinkActive="active"
              ariaCurrentWhenActive="page"
            >
              <svg os-icon [icon]="link.icon"></svg>{{ link.label }}
            </a>
          }
        }
        @if (me()?.isServerAdmin) {
          <a
            class="nav-link nav-end"
            routerLink="/networks"
            routerLinkActive="active"
            ariaCurrentWhenActive="page"
          >
            <svg os-icon [icon]="icons.networks"></svg>Networks
          </a>
        }
      </nav>

      <div class="os-shell-content">
        <header class="os-shell-topbar">
          <button
            type="button"
            os-icon-button
            class="os-shell-menu"
            variant="ghost"
            label="Menu"
            aria-controls="sidebar"
            [attr.aria-expanded]="menuOpen()"
            (click)="menuOpen.set(!menuOpen())"
          >
            <svg os-icon [icon]="icons.menu"></svg>
          </button>
          @if (session.role(); as role) {
            <span class="role">{{ roleLabels[role] }}</span>
          }
          <button
            os-button
            type="button"
            variant="ghost"
            size="sm"
            class="account"
            [attr.aria-label]="'Change the password of ' + (me()?.name || me()?.email)"
            (click)="openPassword()"
          >
            {{ me()?.name || me()?.email }}
          </button>
          <button type="button" os-button variant="ghost" size="sm" (click)="signOut()">
            <svg os-icon [icon]="icons.signOut" size="sm"></svg>Sign out
          </button>
        </header>
        <main os-page>
          <router-outlet />
        </main>
      </div>
    </div>

    <dialog os-dialog size="sm" [(open)]="passwordOpen">
      <header os-dialog-header><h2 os-dialog-title>Change your password</h2></header>
      <form id="password-form" os-dialog-body class="stack" (ngSubmit)="changePassword()">
        @if (passwordError(); as error) {
          <os-callout tone="danger">{{ error }}</os-callout>
        }
        <os-field label="Current password">
          <input
            os-input
            type="password"
            name="current"
            autocomplete="current-password"
            required
            [(ngModel)]="current"
          />
        </os-field>
        <os-field
          label="New password"
          hint="At least 10 characters. Your other sessions are signed out."
        >
          <input
            os-input
            type="password"
            name="next"
            autocomplete="new-password"
            required
            minlength="10"
            [(ngModel)]="next"
          />
        </os-field>
      </form>
      <footer os-dialog-footer>
        <button os-button os-dialog-close type="button">Cancel</button>
        <button
          os-button
          variant="primary"
          type="submit"
          form="password-form"
          [loading]="savingPassword()"
        >
          Change password
        </button>
      </footer>
    </dialog>
  `,
  styles: `
    .brand-mark {
      inline-size: 1.5rem;
      block-size: 1.5rem;
    }

    .brand-mark .ring {
      fill: var(--os-fg-default);
    }

    .brand-mark .glyph {
      fill: var(--os-brand-default);
    }

    .network-switch {
      display: block;
      margin-block-end: var(--os-space-3);
    }

    .network-switch select {
      inline-size: 100%;
    }

    .network-name {
      margin: 0 0 var(--os-space-3);
      padding-inline: var(--os-space-3);
      color: var(--os-fg-muted);
      font-size: var(--os-text-sm);
    }

    .nav-end {
      margin-block-start: auto;
    }

    .role {
      color: var(--os-fg-muted);
      font-size: var(--os-text-sm);
    }

    .account {
      max-inline-size: 16rem;
      margin-inline-start: auto;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    @container os-shell (inline-size < 40rem) {
      .role {
        display: none;
      }
    }
  `,
})
export class Shell {
  protected readonly session = inject(Session);
  private readonly router = inject(Router);
  protected readonly me = this.session.me;
  protected readonly network = this.session.network;
  protected readonly menuOpen = signal(false);
  protected readonly roleLabels = ROLE_LABELS;
  protected readonly icons = { networks: iconNetworks, menu: iconMenu, signOut: iconSignOut };

  protected readonly links = computed(() => {
    const role = this.session.role();
    return role ? LINKS.filter((l) => l.roles.includes(role)) : [];
  });

  constructor() {
    const sync = () => {
      const match = /^\/n\/([^/?#]+)/.exec(this.router.url);
      this.session.network.set(match?.[1] ? decodeURIComponent(match[1]) : null);
    };
    sync();
    const sub = this.router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) {
        sync();
        this.menuOpen.set(false);
      }
    });
    inject(DestroyRef).onDestroy(() => {
      sub.unsubscribe();
    });
  }

  protected switchNetwork(event: Event): void {
    const slug = (event.target as HTMLSelectElement).value;
    void this.router.navigate(['/n', slug]);
  }

  private readonly api = inject(Api);
  private readonly toaster = inject(Toaster);
  protected readonly passwordOpen = signal(false);
  protected readonly savingPassword = signal(false);
  protected readonly passwordError = signal<string | null>(null);
  protected current = '';
  protected next = '';

  protected openPassword(): void {
    this.current = '';
    this.next = '';
    this.passwordError.set(null);
    this.passwordOpen.set(true);
  }

  protected async changePassword(): Promise<void> {
    this.savingPassword.set(true);
    this.passwordError.set(null);
    try {
      await this.api.put('/api/me/password', { current: this.current, next: this.next });
      this.passwordOpen.set(false);
      this.toaster.show('Changed your password.', { tone: 'success' });
    } catch (error) {
      this.passwordError.set(errorText(error));
    } finally {
      this.savingPassword.set(false);
    }
  }

  protected async signOut(): Promise<void> {
    await this.session.signOut();
    await this.router.navigate(['/sign-in']);
  }
}
