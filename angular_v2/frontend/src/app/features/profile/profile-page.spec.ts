import { HttpErrorResponse } from '@angular/common/http';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { Observable, Subject } from 'rxjs';
import type { ProfileMe } from './profile-me';
import { ProfileApi } from './profile-api.service';
import { ProfilePage } from './profile-page';

const MEMBER: ProfileMe = {
  id: '0198c000-0000-7000-8000-000000000001',
  username: 'ada',
  email: 'ada@example.org',
  created_at: '2026-01-05T09:00:00.000Z',
  country_code: 'DE',
  region_code: 'BE',
  city: 'Berlin',
  geo_source: 'geoip',
  geo_accuracy_km: 12,
  geo_updated_at: '2026-01-06T09:00:00.000Z',
  first_name: 'Ada',
  last_name: 'Lovelace',
};

class ProfileApiStub {
  readonly rows = new Subject<ProfileMe>();

  constructor(private readonly failure: HttpErrorResponse | null = null) {}

  me(): Observable<ProfileMe> {
    return this.failure === null
      ? this.rows.asObservable()
      : new Observable<ProfileMe>((subscriber) => subscriber.error(this.failure));
  }
}

describe('ProfilePage', () => {
  let fixture: ComponentFixture<ProfilePage>;
  let api: ProfileApiStub;

  function element(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function text(): string {
    return element().textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  async function settle(row: ProfileMe): Promise<void> {
    api.rows.next(row);
    TestBed.tick();
    await Promise.resolve();
    fixture.detectChanges();
  }

  async function start(): Promise<void> {
    api = new ProfileApiStub();
    await TestBed.configureTestingModule({
      imports: [ProfilePage],
      providers: [{ provide: ProfileApi, useValue: api }],
    }).compileComponents();
    fixture = TestBed.createComponent(ProfilePage);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await start();
  });

  it('renders the twelve columns the member is granted', async () => {
    await settle(MEMBER);

    expect(text()).toContain('ada');
    expect(text()).toContain('ada@example.org');
    expect(text()).toContain('0198c000-0000-7000-8000-000000000001');
    expect(text()).toContain('Berlin, BE, DE');
  });

  /**
   * The four things a member would like to know and cannot. Naming them is the point:
   * silence would read as "nothing to report", and a locally-derived "verified"
   * badge would be a claim this response cannot support — `email_verified_at` is
   * outside the grant, and it is a timestamp, not a flag.
   */
  it('says what it cannot show, and why it did not ask', async () => {
    await settle(MEMBER);

    const note = text();
    expect(note).toContain('cannot tell you when the address above was verified');
    expect(note).toContain('outside a member');
    expect(note).toContain('does not ask for them');
    expect(note).toContain('timestamp rather than a flag');
  });

  it('never renders a verified badge, because the column that would justify one is unreadable', async () => {
    await settle(MEMBER);

    // Neither state is printed: `email_verified_at` is unreadable here, so the page
    // has no basis for either word.
    expect(text()).not.toMatch(/not verified|unverified|verified address|address verified/i);
  });

  it('offers the name, email and password changes, and the history', async () => {
    await settle(MEMBER);

    expect(text()).toContain('Your name');
    expect(text()).toContain('Your email address');
    expect(text()).toContain('Your password');
    expect(text()).toContain('Your sign-in history');
  });

  it('passes the address on file to the email form, so the pending one can be contrasted', async () => {
    await settle(MEMBER);

    const form = element().querySelector('app-email-change-form');
    expect(form).not.toBeNull();
    expect(text()).toContain('The address on file is ada@example.org.');
  });

});

/**
 * A failed read needs its own `TestBed`, because the stub has to be failing BEFORE
 * the component is created: an `rxResource` subscribes at creation, so a stub
 * switched afterwards is never called and the test would pass for the wrong reason.
 */
describe('ProfilePage when the read fails', () => {
  let fixture: ComponentFixture<ProfilePage>;

  async function failing(status: number): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [ProfilePage],
      providers: [
        {
          provide: ProfileApi,
          useValue: new ProfileApiStub(new HttpErrorResponse({ status })),
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ProfilePage);
    fixture.detectChanges();
    TestBed.tick();
    await Promise.resolve();
    fixture.detectChanges();
  }

  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  it('reports a refused read instead of rendering an empty profile', async () => {
    await failing(403);

    expect(text()).toContain('may not read its own profile (403)');
    expect((fixture.nativeElement as HTMLElement).querySelector('app-profile-name-form')).toBeNull();
  });

  /**
   * The `users/me` routes are being written in parallel, so until they land this is
   * the truthful answer. Rendering it as "your profile is empty" would be a page that
   * looks finished and is not (AGENTS.md §2.1).
   */
  it('says plainly that the profile route does not exist yet', async () => {
    await failing(404);

    expect(text()).toContain('has no route for the profile yet (404)');
  });
});
