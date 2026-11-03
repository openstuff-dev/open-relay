import { Injectable, computed, inject, signal } from '@angular/core';
import type { Me, MyNetwork, Role } from '@open-relay/contracts';
import { Api } from './api';

/** Who is signed in, and what they do in the network they're looking at. */
@Injectable({ providedIn: 'root' })
export class Session {
  private readonly api = inject(Api);
  readonly me = signal<Me | null>(null);
  /** The network in the URL. Set by the shell. */
  readonly network = signal<string | null>(null);

  readonly membership = computed<MyNetwork | null>(() => {
    const slug = this.network();
    return this.me()?.networks.find((n) => n.slug === slug) ?? null;
  });

  readonly role = computed<Role | null>(() => this.membership()?.role ?? null);
  readonly isAdmin = computed(() => this.role() === 'admin');
  /** Admins and merchant staff add parcels and print labels. */
  readonly isShop = computed(() => this.role() === 'admin' || this.role() === 'merchant');

  /** Loads the account; null when nobody is signed in. */
  async load(): Promise<Me | null> {
    try {
      const me = await this.api.get<Me>('/api/me');
      this.me.set(me);
      return me;
    } catch {
      this.me.set(null);
      return null;
    }
  }

  async signIn(email: string, password: string): Promise<void> {
    await this.api.post('/api/session', { email, password });
    await this.load();
  }

  async signOut(): Promise<void> {
    await this.api.delete('/api/session');
    this.api.clear();
    this.me.set(null);
  }
}

/** Where each role starts: the page they use most. */
export const HOME: Record<Role, string> = {
  admin: 'parcels',
  merchant: 'parcels',
  courier: 'pickups',
  point: 'scan',
};
