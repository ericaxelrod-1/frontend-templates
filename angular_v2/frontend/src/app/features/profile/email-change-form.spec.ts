import { HttpErrorResponse } from '@angular/common/http';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import type { Observable } from 'rxjs';
import { Subject, throwError } from 'rxjs';
import { EmailChangeForm } from './email-change-form';
import type { EmailChangeAccepted } from './email-change-accepted';
import type { EmailChangeRequest } from './email-change-request';
import { ProfileApi } from './profile-api.service';

/**
 * A hand-written `ProfileApi` for this form. Permitted in `*.spec.ts` only
 * (AGENTS.md §2.2); the wire itself is asserted in `profile-api.service.spec.ts`.
 */
class ProfileApiStub {
  readonly emailRequests: EmailChangeRequest[] = [];
  readonly responses = new Subject<EmailChangeAccepted>();
  failWith: HttpErrorResponse | null = null;

  /**
   * `accept()` COMPLETES as well as emitting. The form awaits the call with
   * `lastValueFrom`, which settles on completion — a subject that only emits would
   * leave every assertion below waiting on a request that never finishes.
   */
  requestEmailChange(request: EmailChangeRequest): Observable<EmailChangeAccepted> {
    this.emailRequests.push(request);
    return this.failWith === null ? this.responses.asObservable() : throwError(() => this.failWith);
  }
}

/** The `202`: one emission, then completion. */
function accept(api: ProfileApiStub): void {
  api.responses.next({ accepted: true });
  api.responses.complete();
}

describe('EmailChangeForm', () => {
  let fixture: ComponentFixture<EmailChangeForm>;
  let api: ProfileApiStub;

  function element(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function text(): string {
    return element().textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  function type(value: string): void {
    const input = element().querySelector('input[type="email"]') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function submit(): void {
    (element().querySelector('button[type="submit"]') as HTMLButtonElement).click();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    api = new ProfileApiStub();
    await TestBed.configureTestingModule({
      imports: [EmailChangeForm],
      providers: [{ provide: ProfileApi, useValue: api }],
    }).compileComponents();
    fixture = TestBed.createComponent(EmailChangeForm);
    fixture.componentRef.setInput('currentEmail', 'old@example.org');
    fixture.detectChanges();
  });

  it('says the change takes two steps before anything is typed', () => {
    expect(text()).toContain('Changing the address on your account takes two steps');
    expect(text()).toContain('the address changes only once you confirm it');
  });

  /**
   * The behaviour the whole form exists for. A `202` means a verification link is
   * on its way; the address on the account has NOT changed, and the submitted
   * address must not be presented as if it had.
   */
  it('reports an accepted request as pending, and keeps the address on file on screen', async () => {
    type('new@example.org');
    submit();

    await Promise.resolve();
    accept(api);
    await Promise.resolve();
    fixture.detectChanges();

    expect(api.emailRequests).toEqual([{ email: 'new@example.org' }]);
    expect(text()).toContain('A verification link has been sent to new@example.org');
    expect(text()).toContain('Your address is still old@example.org');
    expect(text()).toContain('is not on your account');
    // The input is cleared: leaving it filled would read as "this is now your
    // address", which is the specific mistake the two-phase flow exists to prevent.
    expect((element().querySelector('input[type="email"]') as HTMLInputElement).value).toBe('');
  });

  it('emits once so the page can re-read the row, without expecting the row to have changed', async () => {
    let emissions = 0;
    fixture.componentInstance.requested.subscribe(() => (emissions += 1));

    type('new@example.org');
    submit();
    await Promise.resolve();
    accept(api);
    await Promise.resolve();

    expect(emissions).toBe(1);
  });

  it('sends the trimmed address and not the raw keystrokes', async () => {
    type('  spaced@example.org  ');
    submit();
    await Promise.resolve();

    expect(api.emailRequests).toEqual([{ email: 'spaced@example.org' }]);
  });

  it('surfaces a refusal with the server’s reason rather than as a bare status', async () => {
    api.failWith = new HttpErrorResponse({
      status: 422,
      error: { message: 'email must not be a disposable domain' },
    });

    type('new@example.org');
    submit();
    await Promise.resolve();
    fixture.detectChanges();

    expect(text()).toContain('email must not be a disposable domain');
    expect(text()).not.toContain('A verification link has been sent');
  });

  it('refuses to send an address that is not shaped like one', () => {
    type('not-an-address');
    submit();

    expect(api.emailRequests).toEqual([]);
  });

  it('reports a route that does not exist yet as a 404 rather than as a failure to send', async () => {
    api.failWith = new HttpErrorResponse({ status: 404 });

    type('new@example.org');
    submit();
    await Promise.resolve();
    fixture.detectChanges();

    expect(text()).toContain('404');
  });
});