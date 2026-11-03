import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Button, Callout, Control, Field } from '@openstuff-dev/ui-angular';
import { errorText } from '../core/api';
import { Session } from '../core/session';

@Component({
  selector: 'app-sign-in',
  imports: [FormsModule, Button, Callout, Control, Field],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="sign-in">
      <form class="card" (ngSubmit)="submit()">
        <h1>Sign in to OpenRelay</h1>
        @if (error(); as error) {
          <os-callout tone="danger">{{ error }}</os-callout>
        }
        <os-field label="Email">
          <input
            os-input
            type="email"
            name="email"
            autocomplete="username"
            required
            [(ngModel)]="email"
          />
        </os-field>
        <os-field label="Password">
          <input
            os-input
            type="password"
            name="password"
            autocomplete="current-password"
            required
            [(ngModel)]="password"
          />
        </os-field>
        <button os-button variant="primary" type="submit" [loading]="busy()">Sign in</button>
        <p class="hint">
          The first admin’s email and password are set with OPENRELAY_ADMIN_EMAIL and
          OPENRELAY_ADMIN_PASSWORD, or shown once in the server log.
        </p>
      </form>
    </main>
  `,
  styles: `
    .sign-in {
      display: grid;
      place-items: center;
      min-block-size: 100dvh;
      padding: var(--os-space-4);
      background: var(--os-bg-alternative);
    }

    .card {
      display: grid;
      gap: var(--os-space-4);
      inline-size: min(24rem, 100%);
      padding: var(--os-space-6);
      border: 1px var(--os-border-style) var(--os-border-default);
      border-radius: var(--os-radius-lg);
      background: var(--os-bg-default);
    }

    h1 {
      margin: 0;
      font-size: var(--os-text-xl);
      text-wrap: balance;
    }

    .hint {
      margin: 0;
      color: var(--os-fg-muted);
      font-size: var(--os-text-sm);
      text-wrap: pretty;
    }
  `,
})
export class SignIn {
  private readonly session = inject(Session);
  private readonly router = inject(Router);
  /** Where to go after signing in. */
  readonly next = input<string>();
  protected email = '';
  protected password = '';
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected async submit(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.session.signIn(this.email, this.password);
      const next = this.next();
      await this.router.navigateByUrl(next?.startsWith('/') && !next.startsWith('//') ? next : '/');
    } catch (error) {
      this.error.set(errorText(error));
    } finally {
      this.busy.set(false);
    }
  }
}
