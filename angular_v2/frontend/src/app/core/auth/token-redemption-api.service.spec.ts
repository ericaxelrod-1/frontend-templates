import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { TokenRedemptionApi } from './token-redemption-api.service';
import type {
  EmailChangeConfirmed,
  EmailVerificationConfirmed,
  PasswordResetConfirmed,
} from './token-redemption.types';

describe('TokenRedemptionApi', () => {
  let service: TokenRedemptionApi;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [TokenRedemptionApi, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(TokenRedemptionApi);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
  });

  it('posts email-verification confirmation with body only and no URL query string', async () => {
    const rawToken = 'test-verification-token-value-12345';
    const promise = firstValueFrom(service.confirmEmailVerification({ token: rawToken }));

    const req = httpTesting.expectOne('/api/auth/email-verification/confirm');
    expect(req.request.method).toBe('POST');
    expect(req.request.urlWithParams).toBe('/api/auth/email-verification/confirm');
    expect(req.request.params.keys().length).toBe(0);
    expect(req.request.body).toEqual({ token: rawToken });

    const expectedResponse: EmailVerificationConfirmed = { status: 'verified' };
    req.flush(expectedResponse);

    const result = await promise;
    expect(result).toEqual(expectedResponse);
  });

  it('posts password-reset confirmation with body only and no URL query string', async () => {
    const rawToken = 'test-reset-token-value-12345';
    const promise = firstValueFrom(
      service.confirmPasswordReset({ token: rawToken, password: 'new-secret-password-123' }),
    );

    const req = httpTesting.expectOne('/api/auth/password-reset/confirm');
    expect(req.request.method).toBe('POST');
    expect(req.request.urlWithParams).toBe('/api/auth/password-reset/confirm');
    expect(req.request.params.keys().length).toBe(0);
    expect(req.request.body).toEqual({
      token: rawToken,
      password: 'new-secret-password-123',
    });

    const expectedResponse: PasswordResetConfirmed = { status: 'password_reset' };
    req.flush(expectedResponse);

    const result = await promise;
    expect(result).toEqual(expectedResponse);
  });

  it('posts email-change confirmation with body only and no URL query string', async () => {
    const rawToken = 'test-email-change-token-value-12345';
    const promise = firstValueFrom(service.confirmEmailChange({ token: rawToken }));

    const req = httpTesting.expectOne('/api/users/me/email/confirm');
    expect(req.request.method).toBe('POST');
    expect(req.request.urlWithParams).toBe('/api/users/me/email/confirm');
    expect(req.request.params.keys().length).toBe(0);
    expect(req.request.body).toEqual({ token: rawToken });

    const expectedResponse: EmailChangeConfirmed = { status: 'email_changed' };
    req.flush(expectedResponse);

    const result = await promise;
    expect(result).toEqual(expectedResponse);
  });

  it('propagates HTTP error responses without swallowing or defaulting', async () => {
    const promise = firstValueFrom(service.confirmEmailVerification({ token: 'bad-token' }));

    const req = httpTesting.expectOne('/api/auth/email-verification/confirm');
    req.flush(
      { message: 'this link is not valid, has already been used, or has expired — request a new one' },
      { status: 400, statusText: 'Bad Request' },
    );

    await expect(promise).rejects.toMatchObject({
      status: 400,
    });
  });
});
