import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { UserAccountState } from './user-account-state';
import type { UserAccountStateRecord } from './user-account-state-record';

describe('UserAccountState', () => {
  let fixture: ComponentFixture<UserAccountState>;

  const NEITHER: UserAccountStateRecord = {
    deletedAt: null,
    deletionReason: null,
    emailAnonymized: null,
    disabledAt: null,
    disabledBy: null,
    disabledReason: null,
    disabledUntil: null,
  };

  function record(overrides: Partial<UserAccountStateRecord> = {}): UserAccountStateRecord {
    return { ...NEITHER, ...overrides };
  }

  function render(
    state: UserAccountStateRecord,
    blocked = false,
  ): string {
    fixture.componentRef.setInput('record', state);
    fixture.componentRef.setInput('blocked', blocked);
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UserAccountState] }).compileComponents();
    fixture = TestBed.createComponent(UserAccountState);
    // Set before the first render: `record` is `input.required`, and reading it in a
    // computed during an initial `detectChanges` throws NG0950. That is the correct
    // behaviour for a component used without its input, so the spec must not do it.
    fixture.componentRef.setInput('record', NEITHER);
    fixture.detectChanges();
  });

  /**
   * A NULL `disabled_until` is not "no expiry known" — it is the record that the
   * disable does not expire, and nothing sweeps it. Rendering the two cases as one
   * sentence would tell an operator a temporary suspension was permanent, or the
   * reverse.
   */
  it('reads a disable with no end as permanent', () => {
    const text = render(
      record({ disabledAt: '2026-03-01T10:00:00.000Z', disabledReason: 'security', disabledBy: 'admin-1' }),
    );

    expect(text).toContain('Disabled');
    expect(text).toContain('automated security block');
    expect(text).toContain('Permanent');
    expect(text).not.toContain('Temporary');
  });

  it('reads a disable with an end as temporary, and names when it ends', () => {
    const text = render(
      record({
        disabledAt: '2026-03-01T10:00:00.000Z',
        disabledReason: 'admin',
        disabledBy: 'admin-1',
        disabledUntil: '2026-03-08T10:00:00.000Z',
      }),
    );

    expect(text).toContain('Temporary');
    expect(text).toContain('administrator action');
    expect(text).not.toContain('Permanent');
  });

  it('says why a disable has no administrator recorded against it', () => {
    const text = render(record({ disabledAt: '2026-03-01T10:00:00.000Z', disabledReason: 'compliance' }));

    expect(text).toContain('No administrator is recorded');
  });

  /**
   * The erasure record is evidence that an erasure was HONOURED rather than merely
   * requested, which is why it is on the page at all.
   */
  it('reports an erasure with its reason and whether the address was anonymized', () => {
    const anonymized = render(
      record({ deletedAt: '2026-01-02T00:00:00.000Z', deletionReason: 'rtbf', emailAnonymized: true }),
    );
    expect(anonymized).toContain('Erased');
    expect(anonymized).toContain("erased at the member's request");
    expect(anonymized).toContain('email address was anonymized');

    const notAnonymized = render(
      record({ deletedAt: '2026-01-02T00:00:00.000Z', deletionReason: 'rtbf', emailAnonymized: false }),
    );
    expect(notAnonymized).not.toContain('email address was anonymized');
  });

  it('says so when nothing has been done to the account', () => {
    expect(render(record())).toBe('No erasure and no disable recorded.');
  });

  /**
   * "This account was never disabled" and "these columns are not readable for your
   * role" must not render the same cell. The second is what an `app_member` sees,
   * because the seven columns here are outside its grant.
   */
  it('says the columns are not readable rather than showing an empty state', () => {
    expect(render(record({ disabledAt: '2026-03-01T10:00:00.000Z' }), true)).toBe(
      'not readable for this role',
    );
  });

  it('shows a deletion reason the vocabulary does not contain, with its raw value', () => {
    const text = render(
      record({ deletedAt: '2026-01-02T00:00:00.000Z', deletionReason: 'court_order' }),
    );

    expect(text).toContain('unrecognised code "court_order"');
  });
});