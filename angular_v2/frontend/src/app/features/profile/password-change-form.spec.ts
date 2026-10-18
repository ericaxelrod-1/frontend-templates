import { HttpErrorResponse } from '@angular/common/http';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import type { Observable} from 'rxjs';
import { Subject, throwError } from 'rxjs';
import { ProfilePasswordForm } from './password-change-form';
import { ProfileApi } from './profile-api.service';
import type { PasswordChangeRequest } from './password-change-request';

class ProfileApiStub {
  readonly requests: PasswordChangeRequest[] = [];
  readonly responses = new Subject<void>();
  failWith: HttpErrorResponse | null = null;

  changePassword(request: PasswordChangeRequest): Observable<void> {
    this.requests.push(request);
    return this.failWith === null ? this.responses.asObservable() : throwError(() => this.failWith);
  }
}

describe('ProfilePasswordForm', () => {
  let fixture: ComponentFixture<ProfilePasswordForm>;
  let api: ProfileApiStub;

  function element(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function text(): string {
    return element().textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  function field(label: 'current-password' | 'new-password'): HTMLInputElement {
    return element().querySelector(`input[autocomplete="${label}"]`) as HTMLInputElement;
  }

  function typeInto(label: 'current-password' | 'new-password', value: string): void {
    const input = field(label);
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
      imports: [ProfilePasswordForm],
      providers: [{ provide: ProfileApi, useValue: api }],
    }).compileComponents();
    fixture = TestBed.createComponent(ProfilePasswordForm);
    fixture.detectChanges();
  });

  it('sends both fields, and only those two', () => {
    typeInto('current-password', 'old-one');
    typeInto('new-password', 'new-one');
    submit();

    expect(api.requests).toEqual([{ current_password: 'old-one', new_password: 'new-one' }]);
    expect(Object.keys(api.requests[0] ?? {})).not.toContain('confirm_password');
  });

  it('refuses to send a half-filled form', () => {
    typeInto('current-password', 'old-one');
    submit();

    expect(api.requests).toEqual([]);
  });

  it('clears both fields once the change has been accepted', async () => {
    typeInto('current-password', 'old-one');
    typeInto('new-password', 'new-one');
    submit();
    await Promise.resolve();
    api.responses.next();
    api.responses.complete();
    await Promise.resolve();
    fixture.detectChanges();

    expect(field('current-password').value).toBe('');
    expect(field('new-password').value).toBe('');
    expect(text()).toContain('Your password has been changed.');
  });

  /**
   * It claims nothing beyond what the route answered. Whether a password change
   * invalidates refresh tokens is the backend's decision, and a page that asserted
   * it either way would be a comment that can be wrong.
   */
  it('does not claim that other sessions were ended', async () => {
    typeInto('current-password', 'old-one');
    typeInto('new-password', 'new-one');
    submit();
    await Promise.resolve();
    api.responses.next();
    api.responses.complete();
    await Promise.resolve();
    fixture.detectChanges();

    expect(text()).not.toContain('other sessions');
    expect(text()).not.toContain('signed out');
  });

  it('keeps the typed values when the change is refused, and shows the reason', async () => {
    api.failWith = new HttpErrorResponse({
      status: 422,
      error: { message: 'current_password is not the current password' },
    });

    typeInto('current-password', 'wrong-one');
    typeInto('new-password', 'new-one');
    submit();
    await Promise.resolve();
    fixture.detectChanges();

    expect(text()).toContain('current_password is not the current password');
    expect(field('new-password').value).toBe('new-one');
    expect(field('current-password').value).toBe('wrong-one');
  });
});