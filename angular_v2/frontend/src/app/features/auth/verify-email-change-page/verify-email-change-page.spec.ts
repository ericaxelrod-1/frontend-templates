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
import { VerifyEmailChangePage } from './verify-email-change-page';

class TokenRedemptionApiStub {
  readonly emailChangeRequests: EmailChangeConfirmRequest[] = [];
  readonly emailChangeResponses = new Subject<EmailChangeConfirmed>();
  failWith: HttpErrorResponse | null = null;

  confirmEmailVerification(
    _request: EmailVerificationConfirmRequest,
  ): Observable<EmailVerificationConfirmed> {
    return throwError(() => new Error('confirmEmailVerification not implemented in this spec'));
  }

  confirmPasswordReset(
    _request: PasswordResetConfirmRequest,
  ): Observable<PasswordResetConfirmed> {
    return throwError(() => new Error('confirmPasswordReset not implemented in this spec'));
  }

  confirmEmailChange(request: EmailChangeConfirmRequest): Observable<EmailChangeConfirmed> {
    this.emailChangeRequests.push(request);
    return this.failWith === null
      ? this.emailChangeResponses.asObservable()
      : throwError(() => this.failWith);
  }
}

describe('VerifyEmailChangePage', () => {
  let fixture: ComponentFixture<VerifyEmailChangePage>;
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
      imports: [VerifyEmailChangePage],
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

    fixture = TestBed.createComponent(VerifyEmailChangePage);
    fixture.detectChanges();
  }

  it('renders server-rendered shell without calling the API or touching window', async () => {
    await createComponent('token-for-email-change-ssr', 'server');

    expect(api.emailChangeRequests.length).toBe(0);
    expect(text()).toContain('Confirming your new email address…');
  });

  it('reports an incomplete link if no token is present in the URL query', async () => {
    await createComponent(null, 'browser');

    expect(api.emailChangeRequests.length).toBe(0);
    expect(text()).toContain('This confirmation link is incomplete — no confirmation token was provided');
    expect(text()).toContain('Go to sign in');
  });

  it('redeems token on browser load and reports success with sign-in advice', async () => {
    const rawToken = 'valid-change-token-12345';
    await createComponent(rawToken, 'browser');

    expect(api.emailChangeRequests).toEqual([{ token: rawToken }]);
    expect(text()).toContain('Confirming your new email address…');

    api.emailChangeResponses.next({ status: 'email_changed' });
    api.emailChangeResponses.complete();
    await Promise.resolve();
    fixture.detectChanges();

    expect(text()).toContain('Your email address has been updated');
    expect(text()).toContain('If you are currently signed in, please sign in again with your new email address');
    expect(element().querySelector('a[href="/login"]')).not.toBeNull();
  });

  it('renders the server refusal message when token is unusable', async () => {
    await createComponent('unusable-token-12345', 'browser');

    const refusalMessage =
      'this link is not valid, has already been used, or has expired — request a new one';
    api.failWith = new HttpErrorResponse({
      status: 422,
      error: { statusCode: 422, message: refusalMessage },
    });

    api.emailChangeRequests.length = 0;
    const retestFixture = TestBed.createComponent(VerifyEmailChangePage);
    retestFixture.detectChanges();
    await Promise.resolve();
    retestFixture.detectChanges();

    const pageText = (retestFixture.nativeElement as HTMLElement).textContent?.replace(/\s+/g, ' ').trim() ?? '';
    expect(pageText).toContain(refusalMessage);
    expect(pageText).toContain('The link may have already been used or has expired');
    expect(pageText).toContain('Go to sign in');
  });

  it('renders the server refusal message when destination email is taken by another account', async () => {
    await createComponent('collision-token-12345', 'browser');

    const takenMessage =
      'another live account uses that address now, so the change was not applied — request one again';
    api.failWith = new HttpErrorResponse({
      status: 422,
      error: { statusCode: 422, message: takenMessage },
    });

    api.emailChangeRequests.length = 0;
    const retestFixture = TestBed.createComponent(VerifyEmailChangePage);
    retestFixture.detectChanges();
    await Promise.resolve();
    retestFixture.detectChanges();

    const pageText = (retestFixture.nativeElement as HTMLElement).textContent?.replace(/\s+/g, ' ').trim() ?? '';
    expect(pageText).toContain(takenMessage);
  });
});
