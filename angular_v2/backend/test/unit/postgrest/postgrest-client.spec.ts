import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { PostgrestClient } from '../../../src/postgrest/postgrest-client.js';
import {
  PostgrestResponseError,
  PostgrestUnavailableError,
} from '../../../src/postgrest/postgrest.errors.js';

function createMockConfig(baseUrl = 'http://127.0.0.1:3001'): ConfigService {
  return {
    getOrThrow: (key: string) => {
      if (key === 'environment') {
        return {
          postgrest: { baseUrl },
        };
      }
      throw new Error(`Unexpected config key: ${key}`);
    },
  } as unknown as ConfigService;
}

describe('PostgrestClient', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('reads baseUrl from environment configuration without defaulting', () => {
    const client = new PostgrestClient(createMockConfig('https://api.internal:8443/postgrest'));
    expect(client.baseUrl).toBe('https://api.internal:8443/postgrest');
  });

  it('an authenticated request passes the verified caller token in Authorization Bearer header', async () => {
    const client = new PostgrestClient(createMockConfig());
    let capturedRequest: { url: string; init: RequestInit | undefined } | undefined;

    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      capturedRequest = { url, init };
      return Promise.resolve(
        new Response(JSON.stringify([{ id: 'req-1' }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Content-Range': '0-0/1' },
        }),
      );
    });

    const token = 'header.payload.signature';
    const response = await client.get<readonly { id: string }[]>(token, 'privacy_requests');

    expect(capturedRequest).toBeDefined();
    expect(capturedRequest?.url).toBe('http://127.0.0.1:3001/privacy_requests');
    const headers = capturedRequest?.init?.headers as Headers;
    expect(headers.get('Authorization')).toBe(`Bearer ${token}`);
    expect(headers.get('Accept')).toBe('application/json');
    expect(response.status).toBe(200);
    expect(response.count).toBe(1);
    expect(response.data).toEqual([{ id: 'req-1' }]);
  });

  it('an unauthenticated call does not attach an Authorization header', async () => {
    const client = new PostgrestClient(createMockConfig());
    let capturedHeaders: Headers | undefined;

    globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      capturedHeaders = init?.headers as Headers;
      return Promise.resolve(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });

    await client.get(undefined, 'public_status');
    expect(capturedHeaders?.get('Authorization')).toBeNull();

    await client.get('', 'public_status');
    expect(capturedHeaders?.get('Authorization')).toBeNull();
  });

  it('formats query parameters properly and handles arrays without duplicating keys or dropping params', async () => {
    const client = new PostgrestClient(createMockConfig());
    let capturedUrl: string | undefined;

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      capturedUrl = url;
      return Promise.resolve(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });

    await client.get('token', 'users', {
      params: {
        select: 'id,email',
        id: 'in.(1,2)',
        tag: ['alpha', 'beta'],
        empty: undefined,
      },
    });

    expect(capturedUrl).toBeDefined();
    const parsed = new URL(capturedUrl ?? '');
    expect(parsed.pathname).toBe('/users');
    expect(parsed.searchParams.get('select')).toBe('id,email');
    expect(parsed.searchParams.get('id')).toBe('in.(1,2)');
    expect(parsed.searchParams.getAll('tag')).toEqual(['alpha', 'beta']);
    expect(parsed.searchParams.has('empty')).toBe(false);
  });

  it('parses content-range count for total rows and handles missing or wildcard counts', async () => {
    const client = new PostgrestClient(createMockConfig());

    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Range': '0-9/42' },
      }),
    ).mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Range': '0-9/*' },
      }),
    ).mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
      }),
    );

    const res1 = await client.get('t', 'test');
    expect(res1.count).toBe(42);

    const res2 = await client.get('t', 'test');
    expect(res2.count).toBeNull();

    const res3 = await client.get('t', 'test');
    expect(res3.count).toBeNull();
  });

  it('an unreachable PostgREST throws PostgrestUnavailableError and never degrades to empty data or silent success', async () => {
    const client = new PostgrestClient(createMockConfig());

    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed: connect ECONNREFUSED 127.0.0.1:3001'));

    await expect(client.get('caller-token', 'privacy_requests')).rejects.toThrow(PostgrestUnavailableError);

    try {
      await client.get('caller-token', 'privacy_requests');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(PostgrestUnavailableError);
      const unavailable = error as PostgrestUnavailableError;
      expect(unavailable.name).toBe('PostgrestUnavailableError');
      expect(unavailable.url).toContain('http://127.0.0.1:3001/privacy_requests');
      expect(unavailable.message).toContain('PostgREST is unreachable at http://127.0.0.1:3001');
    }
  });

  it('a PostgREST error response throws PostgrestResponseError preserving status, code, and error details', async () => {
    const client = new PostgrestClient(createMockConfig());

    const errorPayload = {
      code: '42501',
      details: 'permission denied for table privacy_requests',
      hint: null,
      message: 'insufficient_privilege',
    };

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(errorPayload), {
        status: 403,
        statusText: 'Forbidden',
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    try {
      await client.post('unauthorized-token', 'privacy_requests', { request_type: 'export' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(PostgrestResponseError);
      const resError = error as PostgrestResponseError;
      expect(resError.status).toBe(403);
      expect(resError.code).toBe('42501');
      expect(resError.message).toBe('insufficient_privilege');
      expect(resError.details).toBe('permission denied for table privacy_requests');
      expect(resError.hint).toBeNull();
      expect(resError.body).toEqual(errorPayload);
      expect(resError.url).toBe('http://127.0.0.1:3001/privacy_requests');
    }
  });

  it('a 204 No Content response resolves with undefined data, 204 status, and preserves headers', async () => {
    const client = new PostgrestClient(createMockConfig());

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 204,
        headers: { 'Preference-Applied': 'return=minimal' },
      }),
    );

    const response = await client.delete<void>('token', 'privacy_requests?id=eq.123');
    expect(response.status).toBe(204);
    expect(response.data).toBeUndefined();
    expect(response.headers.get('Preference-Applied')).toBe('return=minimal');
  });

  it('post, patch, delete methods serialize JSON body and set Content-Type header', async () => {
    const client = new PostgrestClient(createMockConfig());
    const captured: { method?: string; body?: unknown; contentType?: string | null }[] = [];

    globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      const headers = init?.headers as Headers;
      captured.push({
        method: init?.method,
        body: init?.body,
        contentType: headers.get('Content-Type'),
      });
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    });

    await client.post('t', 'items', { name: 'item1' });
    await client.patch('t', 'items?id=eq.1', { name: 'item1-updated' });
    await client.delete('t', 'items?id=eq.1');

    expect(captured).toHaveLength(3);

    expect(captured[0]?.method).toBe('POST');
    expect(captured[0]?.body).toBe(JSON.stringify({ name: 'item1' }));
    expect(captured[0]?.contentType).toBe('application/json');

    expect(captured[1]?.method).toBe('PATCH');
    expect(captured[1]?.body).toBe(JSON.stringify({ name: 'item1-updated' }));
    expect(captured[1]?.contentType).toBe('application/json');

    expect(captured[2]?.method).toBe('DELETE');
    expect(captured[2]?.body).toBeUndefined();
  });
});
