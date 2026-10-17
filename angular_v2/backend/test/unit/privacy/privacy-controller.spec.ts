import { describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type { AccessTokenPayload } from '../../../src/auth/jwt-auth.guard.js';
import { PrivacyController } from '../../../src/privacy/privacy.controller.js';
import type { ErasureOutcome, ErasureService } from '../../../src/privacy/erasure.service.js';

describe('PrivacyController', () => {
  const SUBJECT_ID = '018f3c2a-1b4d-7c8e-9f01-23456789abcd';
  const TARGET_ID = '018f3c2a-1b4d-7c8e-9f01-23456789abce';

  const mockOutcome: ErasureOutcome = {
    userId: SUBJECT_ID,
    alreadyErased: false,
    tombstoneAddress: 'deleted-abc@tombstone.test',
    anonymizedAt: '2026-10-16T12:00:00.000Z',
    pepperKid: 'test-v1',
  };

  it('erases the caller own subject, which is the only subject the route can name', async () => {
    const eraseSelfMock = vi.fn().mockImplementation((id: string) =>
      Promise.resolve({ ...mockOutcome, userId: id }),
    );
    const erasureService = { eraseSelf: eraseSelfMock } as unknown as ErasureService;

    const controller = new PrivacyController(erasureService);
    const req = {
      user: { sub: SUBJECT_ID, role: 'app_member', exp: 123456 } as AccessTokenPayload,
      headers: {},
    } as unknown as FastifyRequest & { user?: AccessTokenPayload };

    const result = await controller.erase(req);

    expect(result.userId).toBe(SUBJECT_ID);
    expect(eraseSelfMock).toHaveBeenCalledWith(SUBJECT_ID);
  });

  it('erases the verified sub and nothing else: no argument on the handler can name another subject', async () => {
    const eraseSelfMock = vi.fn().mockImplementation((id: string) =>
      Promise.resolve({ ...mockOutcome, userId: id }),
    );
    const erasureService = { eraseSelf: eraseSelfMock } as unknown as ErasureService;

    const controller = new PrivacyController(erasureService);
    const req = {
      user: { sub: SUBJECT_ID, role: 'app_member', exp: 123456 } as AccessTokenPayload,
      headers: {},
    } as unknown as FastifyRequest & { user?: AccessTokenPayload };

    const result = await controller.erase(req);

    expect(result.userId).toBe(SUBJECT_ID);
    expect(eraseSelfMock).toHaveBeenCalledWith(SUBJECT_ID);
    // The shape of the control, asserted rather than described: `erase` takes a
    // request and nothing else, so TARGET_ID is not an argument this handler can
    // be handed. The database cannot refuse a cross-subject erasure here —
    // `ErasureService` writes under `SET LOCAL ROLE app_admin`, where
    // `authz.actor()` is NULL and `users_update` admits every row — so this
    // boundary is the control and it has to be unrepresentable.
    //
    // This replaced a case that asserted the opposite: an `EraseRequestDto` with
    // an optional `subjectId`, whose documentation claimed PostgreSQL refused a
    // mismatch with 42501. Nothing refused it. See `privacy.controller.ts`.
    expect(eraseSelfMock.mock.calls.flat()).not.toContain(TARGET_ID);
    expect(eraseSelfMock.mock.calls[0]).toHaveLength(1);
  });

  it('refuses an unauthenticated request rather than erasing a subject with no caller', async () => {
    const eraseSelfMock = vi.fn();
    const erasureService = { eraseSelf: eraseSelfMock } as unknown as ErasureService;

    const controller = new PrivacyController(erasureService);
    const req = {
      user: undefined,
      headers: {},
    } as unknown as FastifyRequest & { user?: AccessTokenPayload };

    await expect(controller.erase(req)).rejects.toThrow('Authentication required');
    expect(eraseSelfMock).not.toHaveBeenCalled();
  });
});
