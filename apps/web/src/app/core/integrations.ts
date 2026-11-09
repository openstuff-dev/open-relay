import { effect, inject, Injectable, Injector } from '@angular/core';
import { type ClientConnection, startServerIntegrations } from '@openstuff-dev/ui';
import { APP_VERSION } from '../build-version';
import { Session } from './session';

/**
 * Starts OpenVersion and OpenAnnounce in the browser when a server admin connected them on
 * Settings › Integrations. Their packages load only then. Nothing waits for this, and a failure
 * leaves the app as it is: signing in never depends on it.
 */
@Injectable({ providedIn: 'root' })
export class ServerIntegrations {
  private readonly session = inject(Session);
  private readonly injector = inject(Injector);
  private started = false;

  start(): void {
    if (this.started) return;
    this.started = true;
    void startServerIntegrations({
      version: APP_VERSION,
      load: {
        openversion: async (connection) => {
          const [{ configure }] = await Promise.all([
            import('@openstuff-dev/version'),
            import('@openstuff-dev/version/update'),
          ]);
          configure(connection);
          document.body.prepend(document.createElement('ov-update'));
        },
        openannounce: (connection) => this.startAnnounce(connection),
      },
    });
  }

  /** Maintenance and announcements at the top of the page, for the person and network shown. */
  private async startAnnounce(connection: ClientConnection): Promise<void> {
    await Promise.all([
      import('@openstuff-dev/announce/maintenance'),
      import('@openstuff-dev/announce/announcements'),
    ]);
    const elements = ['oa-maintenance', 'oa-announcements'].map((tag) => {
      const element = document.createElement(tag);
      element.setAttribute('url', connection.url);
      element.setAttribute('public-key', connection.publicKey);
      return element;
    });
    const update = document.querySelector('ov-update');
    if (update) update.after(...elements);
    else document.body.prepend(...elements);

    // A new token for each person and network, so switching network changes what they see.
    let asked = 0;
    effect(
      () => {
        const signedIn = this.session.me() !== null;
        const network = this.session.network();
        const ask = ++asked;
        void userToken(signedIn, network).then((token) => {
          if (ask !== asked) return;
          for (const element of elements) {
            if (token) element.setAttribute('user-token', token);
            else element.removeAttribute('user-token');
          }
        });
      },
      { injector: this.injector },
    );
  }
}

/** The signed token for OpenAnnounce, or null: signed out, no secret, or it failed. */
async function userToken(signedIn: boolean, network: string | null): Promise<string | null> {
  if (!signedIn) return null;
  const query = network ? `?network=${encodeURIComponent(network)}` : '';
  try {
    const response = await fetch(`/api/openannounce-token${query}`, {
      credentials: 'same-origin',
    });
    return response.status === 200 ? await response.text() : null;
  } catch {
    return null;
  }
}
