import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { Session } from '../auth/session.service';
import { ConsentApi } from './consent-api.service';
import { ConsentGate, matchPathGlob } from './consent-gate.service';
import type {
  ConsentPageGroup,
  ConsentPurpose,
  ConsentRecord,
  ConsentTag,
  ConsentTagGroup,
} from './consent.types';
import { SnippetInjector } from './snippet-injector.service';

const PURPOSE_ANALYTICS: ConsentPurpose = {
  id: 'p-1',
  key: 'analytics',
  label: 'Analytics',
  description: 'Measures traffic',
  legal_basis: 'consent',
  requires_consent: true,
  policy_version: 1,
  sort_order: 1,
  created_at: '',
  updated_at: '',
};

const PURPOSE_MARKETING: ConsentPurpose = {
  id: 'p-2',
  key: 'marketing',
  label: 'Marketing',
  description: 'Ad targeting',
  legal_basis: 'consent',
  requires_consent: true,
  policy_version: 1,
  sort_order: 2,
  created_at: '',
  updated_at: '',
};

const PURPOSE_NECESSARY: ConsentPurpose = {
  id: 'p-3',
  key: 'necessary',
  label: 'Essential',
  description: 'Core site features',
  legal_basis: 'legitimate_interests',
  requires_consent: false,
  policy_version: 1,
  sort_order: 0,
  created_at: '',
  updated_at: '',
};

const GROUP_PUBLIC: ConsentPageGroup = {
  id: 'g-public',
  key: 'public_pages',
  path_globs: ['/pricing', '/about/*'],
  authenticated_only: false,
  created_at: '',
  updated_at: '',
};

const GROUP_AUTH_ONLY: ConsentPageGroup = {
  id: 'g-auth',
  key: 'app_pages',
  path_globs: ['/profile', '/users'],
  authenticated_only: true,
  created_at: '',
  updated_at: '',
};

const TAG_MULTI_PURPOSE: ConsentTag = {
  id: 't-multi',
  key: 'multi_tag',
  snippet: '<script data-test="multi"></script>',
  purposes: ['analytics', 'marketing'],
  enabled: true,
  created_by: undefined,
  created_at: '',
  updated_at: '',
};

const TAG_ANALYTICS_ONLY: ConsentTag = {
  id: 't-analytics',
  key: 'analytics_tag',
  snippet: '<script data-test="analytics"></script>',
  purposes: ['analytics'],
  enabled: true,
  created_by: undefined,
  created_at: '',
  updated_at: '',
};

const TAG_NECESSARY_ONLY: ConsentTag = {
  id: 't-necessary',
  key: 'necessary_tag',
  snippet: '<script data-test="necessary"></script>',
  purposes: ['necessary'],
  enabled: true,
  created_by: undefined,
  created_at: '',
  updated_at: '',
};

const TAG_GROUPS: ConsentTagGroup[] = [
  { tag_id: 't-multi', group_id: 'g-public' },
  { tag_id: 't-analytics', group_id: 'g-public' },
  { tag_id: 't-necessary', group_id: 'g-public' },
  { tag_id: 't-analytics', group_id: 'g-auth' },
];

describe('matchPathGlob', () => {
  it('matches exact paths and wildcards', () => {
    expect(matchPathGlob('/pricing', '/pricing')).toBe(true);
    expect(matchPathGlob('/pricing/', '/pricing')).toBe(true);
    expect(matchPathGlob('/*', '/pricing')).toBe(true);
    expect(matchPathGlob('/*', '/profile')).toBe(true);
    expect(matchPathGlob('/about/*', '/about/team')).toBe(true);
    expect(matchPathGlob('/about/*', '/pricing')).toBe(false);
  });
});

describe('ConsentGate', () => {
  let gate: ConsentGate;
  let injectorSpy: { inject: ReturnType<typeof vi.fn> };
  let apiSpy: {
    purposes: ReturnType<typeof vi.fn>;
    pageGroups: ReturnType<typeof vi.fn>;
    tags: ReturnType<typeof vi.fn>;
    tagGroups: ReturnType<typeof vi.fn>;
    effectiveConsent: ReturnType<typeof vi.fn>;
    recordConsentDecision: ReturnType<typeof vi.fn>;
  };
  let sessionStub: {
    isAuthenticated: ReturnType<typeof vi.fn>;
    userId: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    localStorage.clear();

    injectorSpy = {
      inject: vi.fn().mockResolvedValue(undefined),
    };

    apiSpy = {
      purposes: vi.fn().mockReturnValue(of([PURPOSE_ANALYTICS, PURPOSE_MARKETING, PURPOSE_NECESSARY])),
      pageGroups: vi.fn().mockReturnValue(of([GROUP_PUBLIC, GROUP_AUTH_ONLY])),
      tags: vi.fn().mockReturnValue(of([TAG_MULTI_PURPOSE, TAG_ANALYTICS_ONLY, TAG_NECESSARY_ONLY])),
      tagGroups: vi.fn().mockReturnValue(of(TAG_GROUPS)),
      effectiveConsent: vi.fn().mockReturnValue(of([])),
      recordConsentDecision: vi.fn().mockReturnValue(of('rec-1')),
    };

    sessionStub = {
      isAuthenticated: vi.fn().mockReturnValue(false),
      userId: vi.fn().mockReturnValue(null),
    };

    TestBed.configureTestingModule({
      providers: [
        ConsentGate,
        { provide: SnippetInjector, useValue: injectorSpy },
        { provide: ConsentApi, useValue: apiSpy },
        { provide: Session, useValue: sessionStub },
        { provide: PLATFORM_ID, useValue: 'browser' },
      ],
    });

    gate = TestBed.inject(ConsentGate);
    gate.setMockConfig({
      purposes: [PURPOSE_ANALYTICS, PURPOSE_MARKETING, PURPOSE_NECESSARY],
      pageGroups: [GROUP_PUBLIC, GROUP_AUTH_ONLY],
      tags: [TAG_MULTI_PURPOSE, TAG_ANALYTICS_ONLY, TAG_NECESSARY_ONLY],
      tagGroups: TAG_GROUPS,
    });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('a tag whose purposes are only partly granted does not load', async () => {
    // Only analytics is granted; marketing is NOT granted
    gate.setDecision('analytics', true);

    await gate.evaluate('/pricing');

    // Multi-purpose tag requires both analytics AND marketing, so it must NOT load
    expect(injectorSpy.inject).not.toHaveBeenCalledWith(TAG_MULTI_PURPOSE.snippet);
  });

  it('a tag whose purposes are all granted does load', async () => {
    // Grant both analytics and marketing
    gate.setDecision('analytics', true);
    gate.setDecision('marketing', true);

    await gate.evaluate('/pricing');

    // Both are granted, so TAG_MULTI_PURPOSE loads
    expect(injectorSpy.inject).toHaveBeenCalledWith(TAG_MULTI_PURPOSE.snippet);
    expect(injectorSpy.inject).toHaveBeenCalledWith(TAG_ANALYTICS_ONLY.snippet);
    expect(injectorSpy.inject).toHaveBeenCalledWith(TAG_NECESSARY_ONLY.snippet);
  });

  it('a page with no matching group loads nothing', async () => {
    gate.setDecision('analytics', true);
    gate.setDecision('marketing', true);

    await gate.evaluate('/unmatched-unknown-path');

    expect(injectorSpy.inject).not.toHaveBeenCalled();
  });

  it('a group with authenticated_only does not match an unauthenticated visitor', async () => {
    sessionStub.isAuthenticated.mockReturnValue(false);
    gate.setDecision('analytics', true);

    // /profile is mapped to GROUP_AUTH_ONLY (authenticated_only = true)
    await gate.evaluate('/profile');

    expect(injectorSpy.inject).not.toHaveBeenCalled();

    // Now sign in and re-evaluate
    sessionStub.isAuthenticated.mockReturnValue(true);
    await gate.evaluate('/profile');

    expect(injectorSpy.inject).toHaveBeenCalledWith(TAG_ANALYTICS_ONLY.snippet);
  });

  it('only an explicit change writes; a page load writes nothing', async () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

    // A page load / evaluation does not write to localStorage or server
    await gate.evaluate('/pricing');
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(apiSpy.recordConsentDecision).not.toHaveBeenCalled();

    // An explicit decision writes
    gate.setDecision('analytics', true);
    expect(setItemSpy).toHaveBeenCalled();
  });

  it('sign-out falls back to the browser decision and writes nothing to the server', () => {
    // 1. Unauthenticated visitor sets anonymous preference: analytics = true
    gate.setDecision('analytics', true);
    expect(gate.decisions().get('analytics')?.granted).toBe(true);

    // 2. User signs in. Server has existing record with analytics = false
    sessionStub.isAuthenticated.mockReturnValue(true);
    sessionStub.userId.mockReturnValue('user-uuid');

    const serverRecords: ConsentRecord[] = [
      {
        id: 'rec-1',
        user_id: 'user-uuid',
        purpose_key: 'analytics',
        granted: false,
        policy_version: 1,
        mechanism: 'settings',
        source: 'app',
        recorded_at: '2026-10-19T08:00:00Z',
      },
    ];
    apiSpy.effectiveConsent.mockReturnValue(of(serverRecords));

    gate.onSignIn('user-uuid');
    // Server record wins while signed in
    expect(gate.decisions().get('analytics')?.granted).toBe(false);

    // Reset spy calls
    apiSpy.recordConsentDecision.mockClear();

    // 3. User signs out
    sessionStub.isAuthenticated.mockReturnValue(false);
    sessionStub.userId.mockReturnValue(null);

    gate.onSignOut();

    // Server was NOT called on sign out
    expect(apiSpy.recordConsentDecision).not.toHaveBeenCalled();

    // Effective state reverted to browser's anonymous decision (true)
    expect(gate.decisions().get('analytics')?.granted).toBe(true);
  });

  it('re-prompts when a purpose policy_version has been updated since decision was recorded', () => {
    gate.setDecision('analytics', true);
    gate.setDecision('marketing', true);
    expect(gate.needsReprompt()).toBe(false);

    // Catalogue bumps policy_version from 1 to 2
    gate.purposes.set([
      { ...PURPOSE_ANALYTICS, policy_version: 2 },
      PURPOSE_MARKETING,
      PURPOSE_NECESSARY,
    ]);

    expect(gate.needsReprompt()).toBe(true);
    expect(gate.repromptPurposes().map((p) => p.key)).toContain('analytics');
  });

  it('surfaces a failed write, and clears the failure once a write succeeds', () => {
    // A decision that was not recorded is not a decision. The write used to be
    // swallowed by the API service, so the gate had nothing to show and the UI
    // reported the choice as saved when no row existed (AGENTS.md §2.3).
    sessionStub.isAuthenticated.mockReturnValue(true);
    apiSpy.recordConsentDecision.mockReturnValue(throwError(() => new Error('404')));

    gate.setDecision('analytics', true);

    expect(gate.writeFailure(), 'a failed write was reported as a success').toContain('not recorded');

    // And a later, successful write clears it — otherwise the message would
    // outlive the failure it describes.
    apiSpy.recordConsentDecision.mockReturnValue(of('rec-2'));
    gate.setDecision('marketing', true);

    expect(gate.writeFailure()).toBeNull();
  });
});
