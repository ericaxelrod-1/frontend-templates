import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../config/environment.js';
import type { PostgrestRequestOptions, PostgrestResponse } from './postgrest.types.js';
import {
  PostgrestResponseError,
  PostgrestUnavailableError,
} from './postgrest.errors.js';

function parseContentRangeCount(contentRangeHeader: string | null): number | null {
  if (contentRangeHeader === null) {
    return null;
  }
  const slashIndex = contentRangeHeader.lastIndexOf('/');
  if (slashIndex === -1) {
    return null;
  }
  const total = contentRangeHeader.slice(slashIndex + 1);
  if (total === '*' || !/^\d+$/.test(total)) {
    return null;
  }
  return Number.parseInt(total, 10);
}

/**
 * The thin app's bridge to PostgREST.
 *
 * ## Why this exists (AGENTS.md §B2, ADR-0023, spec-identity.md)
 *
 * The API layer for this repository is PostgREST. When a logged-in caller does
 * something account-scoped, this service replays that user's already-verified
 * bearer token into PostgREST, so PostgREST sets `request.jwt.claims` inside its
 * request transaction and PostgreSQL evaluates `authz.actor()` to the caller.
 *
 * ### Refused alternatives (preserved for audit)
 *
 * - **Do not set `request.jwt.claims` directly from the app.** `request.jwt.claims`
 *   is an ordinary custom GUC — any role may `SET` it. AGENTS.md §B2 F1 classes
 *   any request-reachable SQL path that can SET it as a P0, and a self-check resting
 *   on it is self-certified: the caller writes both the question and the answer.
 * - **Do not add a `current_user = 'app_admin'` branch to a read policy.**
 *   Measured: that hands any `app_admin` PostgREST token the complete DSAR workload —
 *   7 of 7 requests across every group and tenant.
 *
 * ### Error discipline (AGENTS.md §2.3)
 *
 * If PostgREST is unreachable (connection refused, network drop, timeout), this
 * service throws `PostgrestUnavailableError`. It never catches network failures to
 * return null or empty arrays — an unreachable database layer must fail loudly and
 * must not degrade into a success-shaped value.
 */
@Injectable()
export class PostgrestClient {
  readonly baseUrl: string;

  constructor(config: ConfigService) {
    const env = config.getOrThrow<Environment>('environment');
    this.baseUrl = env.postgrest.baseUrl;
  }

  async request<T>(
    token: string | undefined,
    path: string,
    options?: PostgrestRequestOptions,
  ): Promise<PostgrestResponse<T>> {
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    const targetUrl = new URL(`${this.baseUrl}${cleanPath}`);

    if (options?.params !== undefined) {
      for (const [key, value] of Object.entries(options.params)) {
        if (value !== undefined) {
          if (Array.isArray(value)) {
            for (const item of value) {
              targetUrl.searchParams.append(key, String(item));
            }
          } else {
            targetUrl.searchParams.set(key, String(value));
          }
        }
      }
    }

    const headers = new Headers(options?.headers);
    if (!headers.has('Accept')) {
      headers.set('Accept', 'application/json');
    }
    if (token !== undefined && token.trim() !== '') {
      headers.set('Authorization', `Bearer ${token.trim()}`);
    }

    let bodyPayload: string | undefined;
    if (options?.body !== undefined) {
      if (!headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }
      bodyPayload = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    }

    const fetchInit: RequestInit = {
      method: options?.method ?? 'GET',
      headers,
      body: bodyPayload,
      signal: options?.signal,
    };

    let response: Response;
    try {
      response = await fetch(targetUrl.toString(), fetchInit);
    } catch (error) {
      throw new PostgrestUnavailableError(
        `PostgREST is unreachable at ${this.baseUrl}: ${error instanceof Error ? error.message : String(error)}`,
        { url: targetUrl.toString(), cause: error },
      );
    }

    const count = parseContentRangeCount(response.headers.get('content-range'));

    if (response.status === 204) {
      return {
        data: undefined as unknown as T,
        status: response.status,
        count,
        headers: response.headers,
      };
    }

    const rawText = await response.text();
    let parsedData: unknown;
    try {
      parsedData = rawText.length > 0 ? (JSON.parse(rawText) as unknown) : undefined;
    } catch {
      parsedData = rawText;
    }

    if (!response.ok) {
      let code: string | undefined;
      let message = `PostgREST request failed with status ${response.status}`;
      let details: string | null = null;
      let hint: string | null = null;

      if (typeof parsedData === 'object' && parsedData !== null) {
        const record = parsedData as Record<string, unknown>;
        if (typeof record['code'] === 'string') {
          code = record['code'];
        }
        if (typeof record['message'] === 'string') {
          message = record['message'];
        }
        if (typeof record['details'] === 'string' || record['details'] === null) {
          details = record['details'];
        }
        if (typeof record['hint'] === 'string' || record['hint'] === null) {
          hint = record['hint'];
        }
      }

      throw new PostgrestResponseError(response.status, message, {
        code,
        details,
        hint,
        body: parsedData,
        url: targetUrl.toString(),
      });
    }

    return {
      data: parsedData as T,
      status: response.status,
      count,
      headers: response.headers,
    };
  }

  get<T>(
    token: string | undefined,
    path: string,
    options?: Omit<PostgrestRequestOptions, 'method' | 'body'>,
  ): Promise<PostgrestResponse<T>> {
    return this.request<T>(token, path, { ...options, method: 'GET' });
  }

  post<T>(
    token: string | undefined,
    path: string,
    body?: unknown,
    options?: Omit<PostgrestRequestOptions, 'method' | 'body'>,
  ): Promise<PostgrestResponse<T>> {
    return this.request<T>(token, path, { ...options, method: 'POST', body });
  }

  patch<T>(
    token: string | undefined,
    path: string,
    body?: unknown,
    options?: Omit<PostgrestRequestOptions, 'method' | 'body'>,
  ): Promise<PostgrestResponse<T>> {
    return this.request<T>(token, path, { ...options, method: 'PATCH', body });
  }

  delete<T>(
    token: string | undefined,
    path: string,
    options?: Omit<PostgrestRequestOptions, 'method' | 'body'>,
  ): Promise<PostgrestResponse<T>> {
    return this.request<T>(token, path, { ...options, method: 'DELETE' });
  }
}
