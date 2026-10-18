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
import { VerifyEmailPage } from './verify-email-page';

class TokenRedemptionApiStub {
  readonly verificationRequests: EmailVerificationConfirmRequest[] = [];
  readonly verificationResponses = new Subject<EmailVerificationConfirmed>();
  failWith: HttpErrorResponse | null = null;

  confirmEmailVerification(
    request: EmailVerificationConfirmRequest,
  ): Observable<EmailVerificationConfirmed> {
    this.verificationRequests.push(request);
    return this.failWith === null
      ? this.verificationResponses.asObservable()
      : throwError(() => this.failWith);
  }

  confirmPasswordReset(
    _request: PasswordResetConfirmRequest,
  ): Observable<PasswordResetConfirmed> {
    return throwError(() => new Error('confirmPasswordReset not implemented in this spec'));
  }

  confirmEmailChange(_request: EmailChangeConfirmRequest): Observable<EmailChangeConfirmed> {
    return throwError(() => new Error('confirmEmailChange not implemented in this spec'));
  }
}

describe('VerifyEmailPage', () => {
  let fixture: ComponentFixture<VerifyEmailPage>;
  let api: TokenRedemptionApiStub;

  function element(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function text(): string {
    return element().textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  async function createComponent(
    token: string | null,
    platform: 'browser' | 'server' = 'browser',
  ): Promise<void> {
    api = new TokenRedemptionApiStub();
    const queryParamMap = convertToParamMap(token !== null ? { token } : {});

    await TestBed.configureTestingModule({
      imports: [VerifyEmailPage],
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

    fixture = TestBed.createComponent(VerifyEmailPage);
    fixture.detectChanges();
  }

  it('renders server-rendered shell without calling the API or touching window', async () => {
    await createComponent('test-token-12345', 'server');

    expect(api.verificationRequests.length).toBe(0);
    expect(text()).toContain('Verifying your email address…');
  });

  it('reports an incomplete link if no token is present in the URL query', async () => {
    await createComponent(null, 'browser');

    expect(api.verificationRequests.length).toBe(0);
    expect(text()).toContain('This verification link is incomplete — no verification token was provided');
    expect(text()).toContain('Go to sign in');
  });

  it('redeems token on browser load and renders confirmation on success', async () => {
    await createComponent('valid-token-12345', 'browser');

    expect(api.verificationRequests).toEqual([{ token: 'valid-token-12345' }]);
    expect(text()).toContain('Verifying your email address…');

    api.verificationResponses.next({ status: 'verified' });
    api.verificationResponses.complete();
    await Promise.resolve();
    fixture.detectChanges();

    expect(text()).toContain('Your email address has been verified. You can now sign in');
    expect(element().querySelector('a[href="/login"]')).not.toBeNull();
  });

  it('renders the server refusal message and guidance when the token is unusable', async () => {
    await createComponent('spent-token-12345', 'browser');

    const refusalMessage =
      'this link is not valid, has already been used, or has expired — request a new one';
    api.failWith = new HttpErrorResponse({
      status: 400,
      error: { statusCode: 400, message: refusalMessage },
    });

    // Re-trigger verification with failed API response
    api.verificationRequests.length = 0;
    const retestFixture = TestBed.createComponent(VerifyEmailPage);
    retestFixture.detectChanges();
    await Promise.resolve();
    retestFixture.detectChanges();

    const pageText = (retestFixture.nativeElement as HTMLElement).textContent?.replace(/\s+/g, ' ').trim() ?? '';
    expect(pageText).toContain(refusalMessage);
    expect(pageText).toContain('The link may have already been used or has expired');
    expect(pageText).toContain('Go to sign in');
  });
});
