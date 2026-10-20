import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type { Observable } from 'rxjs';
import { of, throwError } from 'rxjs';
import { AuthApi } from '../../../core/auth/auth-api.service';
import type {
  AuthCaptchaChallenge,
  AuthLoginRequest,
  AuthTokens,
} from '../../../core/auth/auth.types';
import { Session } from '../../../core/auth/session.service';
import { LoginPage } from './login-page';

/**
 * The login page's half of the challenge: when the server asks for one, the page
 * asks for it, shows it, and sends the answer back.
 *
 * **The decision is the server's.** The page never asks for a challenge on its
 * own initiative — a challenge in front of every sign-in is the blanket
 * challenge `docs/security.md` names as the anti-pattern — so the page's job is
 * to react to `428 Precondition Required` and to carry the answer back, not to
 * decide whether one is needed.
 */

const TOKENS: AuthTokens = {
  accessToken: 'an-access-token',
  refreshToken: 'a-refresh-token',
  tokenType: 'Bearer',
  expiresIn: 900,
};

const CHALLENGE: AuthCaptchaChallenge = {
  token: 'a-challenge-token',
  challenge: 'What is 4 + 5?',
  type: 'text',
  expiresAt: '2026-10-19T12:05:00.000Z',
};

class SessionStub {
  readonly requests: AuthLoginRequest[] = [];
  refusal: HttpErrorResponse | null = null;

  login(request: AuthLoginRequest): Observable<AuthTokens> {
    this.requests.push(request);
    return this.refusal === null ? of(TOKENS) : throwError(() => this.refusal);
  }
}

class AuthApiStub {
  issued = 0;
  challenge: AuthCaptchaChallenge = CHALLENGE;
  refusal: HttpErrorResponse | null = null;

  issueCaptcha(): Observable<AuthCaptchaChallenge> {
    this.issued += 1;
    return this.refusal === null ? of(this.challenge) : throwError(() => this.refusal);
  }
}

describe('LoginPage', () => {
  let fixture: ComponentFixture<LoginPage>;
  let session: SessionStub;
  let api: AuthApiStub;

  /**
   * Whether anything has asked for an `HttpClient`.
   *
   * `HttpClient` is `providedIn: 'root'`, so it is always INJECTABLE and a test
   * cannot prove the point by failing to resolve it. What it CAN do is notice
   * that somebody WANTS it: the provider below is a factory, and a factory runs
   * only when the token is injected. So this flag is the evidence.
   */
  let httpRequested = false;

  async function createComponent(): Promise<void> {
    session = new SessionStub();
    api = new AuthApiStub();
    httpRequested = false;
    await TestBed.configureTestingModule({
      imports: [LoginPage],
      providers: [
        provideRouter([]),
        { provide: Session, useValue: session },
        { provide: AuthApi, useValue: api },
        {
          provide: HttpClient,
          useFactory: () => {
            httpRequested = true;
            return {};
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(LoginPage);
    fixture.detectChanges();
  }

  function element(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function text(): string {
    return element().textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  function type(selector: string, value: string): void {
    const input = element().querySelector(selector) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function submit(): void {
    const button = element().querySelector('button[type="submit"]') as HTMLButtonElement;
    button.click();
    fixture.detectChanges();
  }

  /**
   * Let the page finish.
   *
   * A macrotask, not a microtask: the sign-in chain is several awaits deep
   * (`lastValueFrom` on the login, then on the challenge request), and a
   * microtask flush can leave the page mid-flight with the submit button still
   * disabled — which reads as "the second click did nothing".
   */
  async function settle(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
  }

  /** The sign-in as the page sends it: filled in, but with no answer typed. */
  function fillCredentials(): void {
    type('input[autocomplete="username"]', 'ada');
    type('input[type="password"]', 'a-password');
  }

  it('asks for no challenge when the sign-in is simply refused', async () => {
    await createComponent();
    session.refusal = new HttpErrorResponse({ status: 401, error: { statusCode: 401 } });

    fillCredentials();
    submit();
    await settle();

    expect(api.issued, 'a challenge was asked for unprompted').toBe(0);
    expect(text()).toContain('That username and password were not accepted.');
  });

  it('asks for a challenge and shows the question when the server says one is required', async () => {
    await createComponent();
    session.refusal = new HttpErrorResponse({ status: 428, error: { statusCode: 428 } });

    fillCredentials();
    submit();
    await settle();

    expect(api.issued, 'the server asked for a challenge and the page did not get one').toBe(1);
    expect(text()).toContain('What is 4 + 5?');
  });

  it('sends the answer with the next sign-in, and the token with it', async () => {
    await createComponent();
    session.refusal = new HttpErrorResponse({ status: 428, error: { statusCode: 428 } });

    fillCredentials();
    submit();
    await settle();

    session.refusal = null;
    type('input[autocomplete="off"]', '9');
    submit();
    await settle();

    expect(session.requests.length).toBe(2);
    expect(session.requests[1]).toEqual({
      username: 'ada',
      password: 'a-password',
      captchaToken: 'a-challenge-token',
      captchaAnswer: '9',
    });
  });

  it('sends no challenge fields when none was demanded', async () => {
    await createComponent();

    fillCredentials();
    submit();
    await settle();

    expect(session.requests).toEqual([{ username: 'ada', password: 'a-password' }]);
  });

  it('refuses to sign in without an answer, rather than sending an empty one', async () => {
    await createComponent();
    session.refusal = new HttpErrorResponse({ status: 428, error: { statusCode: 428 } });

    fillCredentials();
    submit();
    await settle();

    const sentBefore = session.requests.length;
    submit();
    await settle();

    expect(session.requests.length, 'a sign-in was sent with no answer').toBe(sentBefore);
    expect(text()).toContain('Answer the question to sign in.');
  });

  it('asks for a fresh challenge when the server asks again, and empties the box', async () => {
    await createComponent();
    session.refusal = new HttpErrorResponse({ status: 428, error: { statusCode: 428 } });

    fillCredentials();
    submit();
    await settle();

    // The answer was wrong: the challenge is single-use, so the server spends it
    // and asks again. The page must not keep the spent token.
    type('input[autocomplete="off"]', 'wrong');
    submit();
    await settle();

    expect(api.issued, 'the page did not ask for a fresh challenge').toBe(2);
    expect((element().querySelector('input[autocomplete="off"]') as HTMLInputElement).value).toBe('');
  });

  it('owns no HTTP: nothing in this page asked for an HttpClient', () => {
    // `AGENTS.md` §F4: "HTTP calls live in services only. A component that injects
    // `HttpClient` is an architectural violation."
    expect(httpRequested).toBe(false);
  });

  it('navigates to the profile after a successful sign-in', async () => {
    await createComponent();
    const router = TestBed.inject(Router);
    const navigated: string[] = [];
    router.navigateByUrl = (url: string) => {
      navigated.push(url);
      return Promise.resolve(true);
    };

    fillCredentials();
    submit();
    await settle();

    expect(navigated).toEqual(['/profile']);
  });
});
