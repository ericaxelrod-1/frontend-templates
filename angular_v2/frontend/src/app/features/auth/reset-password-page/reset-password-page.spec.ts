import { HttpErrorResponse } from '@angular/common/http';
import { PLATFORM_ID } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import type { Observable } from 'rxjs';
import { Subject, throwError } from 'rxjs';
import { TokenRedemptionApi } from '../../../core/auth/token-redemption-api.service';
import type {
  EmailChangeConfirmRequest,
  EmailChangeConfirmed,
  EmailVerificationConfirmRequest,
  EmailVerificationConfirmed,
  PasswordResetConfirmRequest,
  PasswordResetConfirmed,
} from '../../../core/auth/token-redemption.types';
import { ResetPasswordPage } from './reset-password-page';

class TokenRedemptionApiStub {
  readonly resetRequests: PasswordResetConfirmRequest[] = [];
  readonly resetResponses = new Subject<PasswordResetConfirmed>();
  failWith: HttpErrorResponse | null = null;

  confirmEmailVerification(
    _request: EmailVerificationConfirmRequest,
  ): Observable<EmailVerificationConfirmed> {
    return throwError(() => new Error('confirmEmailVerification not implemented in this spec'));
  }

  confirmPasswordReset(
    request: PasswordResetConfirmRequest,
  ): Observable<PasswordResetConfirmed> {
    this.resetRequests.push(request);
    return this.failWith === null
      ? this.resetResponses.asObservable()
      : throwError(() => this.failWith);
  }

  confirmEmailChange(_request: EmailChangeConfirmRequest): Observable<EmailChangeConfirmed> {
    return throwError(() => new Error('confirmEmailChange not implemented in this spec'));
  }
}

describe('ResetPasswordPage', () => {
  let fixture: ComponentFixture<ResetPasswordPage>;
  let api: TokenRedemptionApiStub;

  function element(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function text(): string {
    return element().textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  function typePassword(value: string): void {
    const input = element().querySelector('input[type="password"]') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function submit(): void {
    const button = element().querySelector('button[type="submit"]') as HTMLButtonElement;
    button.click();
    fixture.detectChanges();
  }

  async function createComponent(
    token: string | null,
    platform: 'browser' | 'server' = 'browser',
  ): Promise<void> {
    api = new TokenRedemptionApiStub();
    const queryParamMap = convertToParamMap(token !== null ? { token } : {});

    await TestBed.configureTestingModule({
      imports: [ResetPasswordPage],
      providers: [
        provideRouter([]),
        { provide: TokenRedemptionApi, useValue: api },
        { provide: PLATFORM_ID, useValue: platform },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              queryParamMap,
            },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ResetPasswordPage);
    fixture.detectChanges();
  }

  it('renders server-rendered shell without calling the API or touching window', async () => {
    await createComponent('token-for-ssr-test', 'server');

    expect(api.resetRequests.length).toBe(0);
    expect(element().querySelector('form')).toBeNull();
  });

  it('reports the link as incomplete when no token is present in the URL query and hides the form', async () => {
    await createComponent(null, 'browser');

    expect(api.resetRequests.length).toBe(0);
    expect(text()).toContain('This password reset link is incomplete — no reset token was provided');
    expect(element().querySelector('form')).toBeNull();
  });

  it('does NOT redeem on GET when token is present, and only redeems upon form submit', async () => {
    const rawToken = 'my-secret-reset-token-12345';
    await createComponent(rawToken, 'browser');

    // On load: token is present, form is displayed, but NO HTTP call is made!
    expect(api.resetRequests.length).toBe(0);
    expect(element().querySelector('form')).not.toBeNull();

    // Type new password and submit
    typePassword('BrandNewPassword123!');
    submit();

    await Promise.resolve();
    expect(api.resetRequests.length).toBe(1);
    expect(api.resetRequests[0]).toEqual({
      token: rawToken,
      password: 'BrandNewPassword123!',
    });

    // Complete response
    api.resetResponses.next({ status: 'password_reset' });
    api.resetResponses.complete();
    await Promise.resolve();
    fixture.detectChanges();

    expect(text()).toContain('Your password has been reset. You can now sign in with your new password');
    expect(element().querySelector('a[href="/login"]')).not.toBeNull();
  });

  it('renders server refusal message when token is unusable', async () => {
    await createComponent('unusable-token-12345', 'browser');

    const refusalMessage =
      'this link is not valid, has already been used, or has expired — request a new one';
    api.failWith = new HttpErrorResponse({
      status: 400,
      error: { statusCode: 400, message: refusalMessage },
    });

    typePassword('BrandNewPassword123!');
    submit();

    await Promise.resolve();
    fixture.detectChanges();

    expect(text()).toContain(refusalMessage);
  });

  it('renders server refusal message when new password fails validation policy', async () => {
    await createComponent('valid-token-12345', 'browser');

    const policyMessage = 'password must be longer than or equal to 1 characters';
    api.failWith = new HttpErrorResponse({
      status: 400,
      error: { statusCode: 400, message: [policyMessage] },
    });

    typePassword('a');
    submit();

    await Promise.resolve();
    fixture.detectChanges();

    expect(text()).toContain(policyMessage);
  });
});
