import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';

/** An error the server explained. `message` is safe to show. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** The whole answer, for errors that carry more than a message (a refused scan). */
    readonly body?: unknown,
  ) {
    super(message);
  }
}

export interface GetOptions<T> {
  /**
   * Called when a stored answer was shown and the fresh one turned out different.
   * Without it, `get` waits for the network.
   */
  onFresh?: (value: T) => void;
}

/**
 * Every call to the server goes through here (the OpenPurpose pattern, smaller):
 *
 * - Two GETs for the same path at the same time share one request.
 * - With `onFresh`, a GET answers at once from the store and fetches again behind the scenes.
 * - Any change (POST, PUT, PATCH, DELETE) clears the store when it's sent and when it lands.
 * - A 401 sends the person to the sign-in page.
 */
@Injectable({ providedIn: 'root' })
export class Api {
  private readonly router = inject(Router);
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly store = new Map<string, unknown>();

  get<T>(path: string, options: GetOptions<T> = {}): Promise<T> {
    const stored = this.store.get(path) as T | undefined;
    const fresh = this.fetchShared<T>(path);
    if (stored !== undefined && options.onFresh) {
      const onFresh = options.onFresh;
      void fresh
        .then((value) => {
          if (JSON.stringify(value) !== JSON.stringify(stored)) onFresh(structuredClone(value));
        })
        .catch(() => undefined);
      return Promise.resolve(structuredClone(stored));
    }
    return fresh.then((value) => structuredClone(value));
  }

  post<T>(path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    return this.send<T>('POST', path, body, idempotencyKey);
  }

  put<T>(path: string, body: unknown): Promise<T> {
    return this.send<T>('PUT', path, body);
  }

  patch<T>(path: string, body: unknown): Promise<T> {
    return this.send<T>('PATCH', path, body);
  }

  delete(path: string): Promise<unknown> {
    return this.send('DELETE', path);
  }

  /** Forgets every stored answer, e.g. on sign-out. */
  clear(): void {
    this.store.clear();
  }

  private fetchShared<T>(path: string): Promise<T> {
    let request = this.inFlight.get(path) as Promise<T> | undefined;
    if (!request) {
      request = this.request<T>('GET', path).then((value) => {
        this.store.set(path, value);
        return value;
      });
      const shared = request.finally(() => this.inFlight.delete(path));
      this.inFlight.set(path, shared);
      return shared;
    }
    return request;
  }

  private async send<T>(method: string, path: string, body?: unknown, key?: string): Promise<T> {
    this.store.clear();
    try {
      return await this.request<T>(method, path, body, key);
    } finally {
      this.store.clear();
    }
  }

  private async request<T>(method: string, path: string, body?: unknown, key?: string): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (key) headers['Idempotency-Key'] = key;
    let response: Response;
    try {
      response = await fetch(path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'same-origin',
      });
    } catch {
      throw new ApiError(0, 'The server can’t be reached. Check your connection and try again.');
    }
    if (response.status === 401 && !path.startsWith('/api/session')) {
      this.store.clear();
      void this.router.navigate(['/sign-in'], { queryParams: { next: this.router.url } });
    }
    const text = await response.text();
    const data: unknown = text ? JSON.parse(text) : undefined;
    if (!response.ok) {
      const message = (data as { error?: string } | undefined)?.error ?? `The server answered ${response.status}.`;
      throw new ApiError(response.status, message, data);
    }
    return data as T;
  }
}

/** The message of any error, for showing to people. */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}
