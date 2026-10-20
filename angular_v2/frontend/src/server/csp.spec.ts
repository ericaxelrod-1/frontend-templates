import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import {
  buildContentSecurityPolicy,
  createCspMiddleware,
  parseOriginList,
} from './csp';

describe('parseOriginList', () => {
  it('handles undefined and empty string', () => {
    expect(parseOriginList(undefined)).toEqual([]);
    expect(parseOriginList('')).toEqual([]);
    expect(parseOriginList('   ')).toEqual([]);
  });

  it('splits comma-separated origins', () => {
    expect(
      parseOriginList('https://example.com, https://api.example.com'),
    ).toEqual(['https://example.com', 'https://api.example.com']);
  });

  it('splits whitespace-separated origins', () => {
    expect(
      parseOriginList('https://example.com   https://api.example.com'),
    ).toEqual(['https://example.com', 'https://api.example.com']);
  });

  it('filters empty segments', () => {
    expect(
      parseOriginList(' , https://example.com , , https://other.com, '),
    ).toEqual(['https://example.com', 'https://other.com']);
  });
});

describe('buildContentSecurityPolicy', () => {
  it('generates the default policy allowing essential Angular and tag injector capabilities', () => {
    const csp = buildContentSecurityPolicy({});

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("img-src 'self' data:");
    expect(csp).toContain("font-src 'self'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("frame-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('adds CSP_ALLOWED_ORIGINS to script, connect, img, and frame directives', () => {
    const csp = buildContentSecurityPolicy({
      CSP_ALLOWED_ORIGINS:
        'https://www.googletagmanager.com, https://region1.google-analytics.com',
    });

    expect(csp).toContain(
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://region1.google-analytics.com",
    );
    expect(csp).toContain(
      "connect-src 'self' https://www.googletagmanager.com https://region1.google-analytics.com",
    );
    expect(csp).toContain(
      "img-src 'self' data: https://www.googletagmanager.com https://region1.google-analytics.com",
    );
    expect(csp).toContain(
      "frame-src 'self' https://www.googletagmanager.com https://region1.google-analytics.com",
    );
  });

  it('applies directive-specific keys', () => {
    const csp = buildContentSecurityPolicy({
      CSP_SCRIPT_SRC: 'https://scripts.vendor.test',
      CSP_CONNECT_SRC: 'https://telemetry.vendor.test',
      CSP_STYLE_SRC: 'https://fonts.googleapis.com',
      CSP_FONT_SRC: 'https://fonts.gstatic.com',
      CSP_IMG_SRC: 'https://images.vendor.test',
      CSP_FRAME_SRC: 'https://embed.vendor.test',
    });

    expect(csp).toContain(
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://scripts.vendor.test",
    );
    expect(csp).toContain(
      "connect-src 'self' https://telemetry.vendor.test",
    );
    expect(csp).toContain(
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    );
    expect(csp).toContain("font-src 'self' https://fonts.gstatic.com");
    expect(csp).toContain("img-src 'self' data: https://images.vendor.test");
    expect(csp).toContain("frame-src 'self' https://embed.vendor.test");
  });

  it('deduplicates sources across generic and directive-specific lists', () => {
    const csp = buildContentSecurityPolicy({
      CSP_ALLOWED_ORIGINS: 'https://vendor.test',
      CSP_SCRIPT_SRC: 'https://vendor.test https://other.test',
    });

    expect(csp).toContain(
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://vendor.test https://other.test",
    );
    // Ensure vendor.test is not repeated in script-src
    const scriptSrcDirective = csp
      .split('; ')
      .find((d) => d.startsWith('script-src'));
    expect(scriptSrcDirective).toBe(
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://vendor.test https://other.test",
    );
  });

  it('returns CONTENT_SECURITY_POLICY override verbatim when set', () => {
    const custom = "default-src 'self'; frame-ancestors 'none'";
    const csp = buildContentSecurityPolicy({
      CONTENT_SECURITY_POLICY: custom,
      CSP_ALLOWED_ORIGINS: 'https://ignored.test',
    });

    expect(csp).toBe(custom);
  });
});

describe('createCspMiddleware', () => {
  it('sets Content-Security-Policy header and calls next', () => {
    const middleware = createCspMiddleware({});
    const setHeaderMock = vi.fn();
    const nextMock = vi.fn();

    const mockReq = {} as Request;
    const mockRes = {
      setHeader: setHeaderMock,
    } as unknown as Response;

    middleware(mockReq, mockRes, nextMock);

    expect(setHeaderMock).toHaveBeenCalledWith(
      'Content-Security-Policy',
      expect.stringContaining("default-src 'self'"),
    );
    expect(nextMock).toHaveBeenCalled();
  });
});
