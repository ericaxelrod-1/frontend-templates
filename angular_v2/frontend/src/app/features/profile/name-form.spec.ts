import { HttpErrorResponse } from '@angular/common/http';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import type { Observable} from 'rxjs';
import { Subject, throwError } from 'rxjs';
import { ProfileNameForm } from './name-form';
import type { ProfileMe } from './profile-me';
import { ProfileApi } from './profile-api.service';
import type { ProfileUpdateRequest } from './profile-update-request';

const MEMBER: ProfileMe = {
  id: '0198c000-0000-7000-8000-000000000001',
  username: 'ada',
  email: 'ada@example.org',
  created_at: '2026-01-05T09:00:00.000Z',
  country_code: undefined,
  region_code: undefined,
  city: undefined,
  geo_source: undefined,
  geo_accuracy_km: undefined,
  geo_updated_at: undefined,
  first_name: 'Ada',
  last_name: 'Lovelace',
};

/** A hand-written `ProfileApi`, permitted in `*.spec.ts` only (AGENTS.md §2.2). */
class ProfileApiStub {
  readonly requests: ProfileUpdateRequest[] = [];
  /** `complete()` matters: the form awaits the call with `lastValueFrom`. */
  readonly responses = new Subject<ProfileMe>();

  /** Set to make the next save fail, exercising the refusal path. */
  failWith: HttpErrorResponse | null = null;

  updateMe(request: ProfileUpdateRequest): Observable<ProfileMe> {
    this.requests.push(request);
    return this.failWith === null ? this.responses.asObservable() : throwError(() => this.failWith);
  }
}

describe('ProfileNameForm', () => {
  let fixture: ComponentFixture<ProfileNameForm>;
  let api: ProfileApiStub;

  function element(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function text(): string {
    return element().textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  function field(label: 'given-name' | 'family-name'): HTMLInputElement {
    return element().querySelector(`input[autocomplete="${label}"]`) as HTMLInputElement;
  }

  function typeInto(label: 'given-name' | 'family-name', value: string): void {
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
      imports: [ProfileNameForm],
      providers: [{ provide: ProfileApi, useValue: api }],
    }).compileComponents();
    fixture = TestBed.createComponent(ProfileNameForm);
    fixture.componentRef.setInput('member', MEMBER);
    fixture.detectChanges();
  });

  it('seeds the form from the row the database returned', () => {
    expect(field('given-name').value).toBe('Ada');
    expect(field('family-name').value).toBe('Lovelace');
  });

  /**
   * A name nobody has stated is NULL, and the generated type says `undefined`. The
   * field is empty either way: a name is never derived from the username or the
   * address, so there is nothing to fall back to.
   */
  it('shows an unstated name as an empty field rather than as a guess', () => {
    fixture.componentRef.setInput('member', { ...MEMBER, first_name: undefined });
    fixture.detectChanges();

    expect(field('given-name').value).toBe('');
  });

  /**
   * Both columns travel even when one is unchanged: `forbidNonWhitelisted` makes an
   * absent property a different request, and whether clearing a name is legal is
   * `users_first_name_not_blank`'s decision, not this form's.
   */
  it('sends both name columns, and says it saved', async () => {
    typeInto('given-name', 'Augusta');
    submit();
    await Promise.resolve();

    expect(api.requests).toEqual([{ first_name: 'Augusta', last_name: 'Lovelace' }]);
  });

  it('emits so the page can re-read the stored row, and confirms the save', async () => {
    let emissions = 0;
    fixture.componentInstance.saved.subscribe(() => (emissions += 1));

    submit();
    await Promise.resolve();
    api.responses.next({ ...MEMBER, first_name: 'Augusta' });
    api.responses.complete();
    await Promise.resolve();
    fixture.detectChanges();

    expect(emissions).toBe(1);
    expect(text()).toContain('Saved.');
  });

  /**
   * A refused save must leave the member's edits where they are. Snapping the field
   * back would discard typing on a transient failure and read as "your change was
   * lost" when in fact it was never applied.
   */
  it('keeps the edits on screen and shows the server’s reason when the save is refused', async () => {
    api.failWith = new HttpErrorResponse({
      status: 422,
      error: { message: 'first_name must not be blank' },
    });

    typeInto('given-name', 'Augusta');
    submit();
    await Promise.resolve();
    fixture.detectChanges();

    expect(text()).toContain('first_name must not be blank');
    expect(field('given-name').value).toBe('Augusta');
    expect(text()).not.toContain('Saved.');
  });
});