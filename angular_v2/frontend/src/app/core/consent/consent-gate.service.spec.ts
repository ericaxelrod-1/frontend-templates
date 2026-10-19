import {
  Component,
  ErrorHandler,
  PLATFORM_ID,
  type EnvironmentProviders,
  type Provider,
} from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { NavigationEnd, provideRouter, Router } from '@angular/router';
import { filter, firstValueFrom, of, take, throwError } from 'rxjs';
import type { MockInstance } from 'vitest';
import { POSTGREST_BASE_URL } from '../api/api-base-urls';
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

/**
 * The key the gate keeps the anonymous decisions under.
 *
 * Written out rather than imported, because the storage keys are part of the
 * contract this unit is not allowed to change: a change to this literal has to
 * be a deliberate one, and a test that read the constant out of the
 * implementation would follow it silently.
 */
const ANON_STORAGE_KEY = 'angular_v2.consent.anon.v1';

/**
 * The key the gate keeps the signed-in decisions under.
 *
 * Written out for the same reason as `ANON_STORAGE_KEY`.
 */
const USER_STORAGE_KEY = 'angular_v2.consent.user.v1';

interface GateStubs {
  injector: { inject: ReturnType<typeof vi.fn> };
  api: {
    purposes: ReturnType<typeof vi.fn>;
    pageGroups: ReturnType<typeof vi.fn>;
    tags: ReturnType<typeof vi.fn>;
    tagGroups: ReturnType<typeof vi.fn>;
    effectiveConsent: ReturnType<typeof vi.fn>;
    recordConsentDecision: ReturnType<typeof vi.fn>;
  };
  session: {
    isAuthenticated: ReturnType<typeof vi.fn>;
    userId: ReturnType<typeof vi.fn>;
  };
  errorHandler: { handleError: ReturnType<typeof vi.fn> };
}

function createStubs(): GateStubs {
  return {
    injector: {
      inject: vi.fn().mockResolvedValue(undefined),
    },
    api: {
      purposes: vi.fn().mockReturnValue(of([PURPOSE_ANALYTICS, PURPOSE_MARKETING, PURPOSE_NECESSARY])),
      pageGroups: vi.fn().mockReturnValue(of([GROUP_PUBLIC, GROUP_AUTH_ONLY])),
      tags: vi.fn().mockReturnValue(of([TAG_MULTI_PURPOSE, TAG_ANALYTICS_ONLY, TAG_NECESSARY_ONLY])),
      tagGroups: vi.fn().mockReturnValue(of(TAG_GROUPS)),
      effectiveConsent: vi.fn().mockReturnValue(of([])),
      recordConsentDecision: vi.fn().mockReturnValue(of('rec-1')),
    },
    session: {
      isAuthenticated: vi.fn().mockReturnValue(false),
      userId: vi.fn().mockReturnValue(null),
    },
    errorHandler: {
      handleError: vi.fn(),
    },
  };
}

function configureGate(
  stubs: GateStubs,
  extraProviders: Array<Provider | EnvironmentProviders> = [],
): void {
  TestBed.configureTestingModule({
    providers: [
      ConsentGate,
      { provide: SnippetInjector, useValue: stubs.injector },
      { provide: ConsentApi, useValue: stubs.api },
      { provide: Session, useValue: stubs.session },
      { provide: ErrorHandler, useValue: stubs.errorHandler },
      { provide: PLATFORM_ID, useValue: 'browser' },
      ...extraProviders,
    ],
  });
}

/** Lets every promise the gate has pending settle. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Navigates, and resolves once the router has emitted the `NavigationEnd` the
 * gate subscribes to.
 *
 * The event is what the router's own `navigated` flag is set from, so waiting
 * for it is what makes "the router has already navigated" a fact rather than a
 * hope.
 */
async function navigate(router: Router, url: string): Promise<void> {
  const ended = firstValueFrom(
    router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      take(1),
    ),
  );
  await router.navigateByUrl(url);
  await ended;
}

@Component({ selector: 'app-stub-page', standalone: true, template: '' })
class StubPage {}

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
  let apiSpy: GateStubs['api'];
  let sessionStub: GateStubs['session'];

  beforeEach(() => {
    localStorage.clear();

    const stubs = createStubs();
    injectorSpy = stubs.injector;
    apiSpy = stubs.api;
    sessionStub = stubs.session;

    configureGate(stubs);

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

/**
 * THE LANDING PAGE.
 *
 * `ConsentGate` is `providedIn: 'root'`, so it is constructed on FIRST
 * INJECTION. When that injection happens after the router has already emitted
 * `NavigationEnd` for the route that brought the visitor here, a gate that
 * only subscribes to `NavigationEnd` never evaluates the page the visitor
 * landed on — the page view analytics exists to record.
 */
describe('ConsentGate — the page the visitor landed on', () => {
  let stubs: GateStubs;
  let router: Router;
  let evaluateSpy: MockInstance<ConsentGate['evaluate']>;

  beforeEach(async () => {
    localStorage.clear();
    stubs = createStubs();

    configureGate(stubs, [
      provideRouter([
        { path: 'pricing', component: StubPage },
        { path: 'other', component: StubPage },
      ]),
    ]);

    router = TestBed.inject(Router);
    // The navigation that brought the visitor here happens BEFORE the gate
    // exists — which is the whole point: the gate cannot have seen it.
    await navigate(router, '/pricing');

    evaluateSpy = vi.spyOn(ConsentGate.prototype, 'evaluate');
    TestBed.inject(ConsentGate);
  });

  afterEach(() => {
    evaluateSpy.mockRestore();
    localStorage.clear();
  });

  it('evaluates the landing page, without a navigation event', async () => {
    expect(router.navigated, 'the premise of this test is a completed navigation').toBe(true);

    await flush();

    expect(evaluateSpy, 'the landing page was never evaluated').toHaveBeenCalledWith('/pricing');
    expect(
      stubs.injector.inject,
      'the tag configured for the landing page did not load',
    ).toHaveBeenCalledWith(TAG_NECESSARY_ONLY.snippet);
  });

  it('evaluates a later navigation', async () => {
    await navigate(router, '/other');
    await flush();

    expect(evaluateSpy, 'the later navigation was not evaluated').toHaveBeenCalledWith('/other');
  });
});

describe('ConsentGate — on the server', () => {
  it('does not evaluate, does not fetch, and does not touch a browser global', () => {
    const stubs = createStubs();
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem');
    const evaluateSpy = vi.spyOn(ConsentGate.prototype, 'evaluate');

    TestBed.configureTestingModule({
      providers: [
        ConsentGate,
        { provide: SnippetInjector, useValue: stubs.injector },
        { provide: ConsentApi, useValue: stubs.api },
        { provide: Session, useValue: stubs.session },
        { provide: ErrorHandler, useValue: stubs.errorHandler },
        { provide: PLATFORM_ID, useValue: 'server' },
      ],
    });
    TestBed.inject(ConsentGate);

    expect(evaluateSpy, 'the server evaluated a route').not.toHaveBeenCalled();
    expect(stubs.api.purposes, 'the server fetched the catalogue').not.toHaveBeenCalled();
    expect(getItemSpy, 'the server touched localStorage').not.toHaveBeenCalled();
    expect(stubs.injector.inject, 'the server injected a tag').not.toHaveBeenCalled();

    evaluateSpy.mockRestore();
    getItemSpy.mockRestore();
  });
});

describe('ConsentGate — a catalogue that cannot be fetched', () => {
  it('reports the failure instead of resolving as if it had loaded', async () => {
    const stubs = createStubs();
    stubs.api.purposes.mockReturnValue(throwError(() => new Error('the catalogue is unreachable')));
    configureGate(stubs);
    const gate = TestBed.inject(ConsentGate);

    await gate.evaluate('/pricing');

    expect(gate.configFailure(), 'the failed catalogue load was silent').not.toBeNull();
    expect(stubs.errorHandler.handleError, 'the failed catalogue load was not reported').toHaveBeenCalled();
    expect(stubs.injector.inject, 'a tag was injected without a catalogue').not.toHaveBeenCalled();

    // And the failure is not hidden behind a resolved promise either: a caller
    // that asks for the configuration is told that there is none.
    await expect(gate.ensureConfiguration()).rejects.toThrow(/unreachable/);
  });
});

describe('ConsentGate — stored decisions that cannot be read or written', () => {
  it('reports a stored decision it could not read, and does not destroy it', () => {
    const stored = [
      {
        purposeKey: 'analytics',
        granted: true,
        policyVersion: 1,
        mechanism: 'consent_control',
        recordedAt: '2026-10-19T08:00:00Z',
      },
    ];
    localStorage.setItem(ANON_STORAGE_KEY, JSON.stringify(stored));

    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage is disabled');
    });

    const stubs = createStubs();
    configureGate(stubs);
    // The constructor restores the stored decisions, and that is the read that
    // fails.
    const gate = TestBed.inject(ConsentGate);

    getItemSpy.mockRestore();

    expect(gate.storageFailure(), 'the unreadable stored decision was discarded silently').not.toBeNull();
    expect(stubs.errorHandler.handleError, 'the unreadable stored decision was not reported').toHaveBeenCalled();
    expect(
      localStorage.getItem(ANON_STORAGE_KEY),
      'the stored decision was destroyed by a failed read',
    ).toBe(JSON.stringify(stored));
  });

  it('reports a decision it could not store', () => {
    const stubs = createStubs();
    configureGate(stubs);
    const gate = TestBed.inject(ConsentGate);

    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    gate.setDecision('analytics', true);
    setItemSpy.mockRestore();

    expect(gate.storageFailure(), 'the decision that was not stored was not reported').not.toBeNull();
    expect(gate.decisions().get('analytics')?.granted).toBe(true);
  });
});

/**
 * THE THIRD STATE.
 *
 * "What does the server hold for this person?" has three answers:
 *
 * 1. it holds records, and they win;
 * 2. it holds none, and the browser's decision is adopted and recorded;
 * 3. it did not answer, and NOTHING is written.
 *
 * States 2 and 3 used to be the same state, because the read used to answer
 * a failed request with an empty list. The difference between them is a row
 * in an append-only log, so the two must not be the same: state 2 adds a
 * record, state 3 must not, and a record added because a read failed can
 * never be taken back.
 */
describe('ConsentGate — a read of the server records that fails', () => {
  let stubs: GateStubs;
  let gate: ConsentGate;

  /** The decision the person made in this browser, before signing in. */
  const BROWSER_DECISION = {
    purposeKey: 'analytics',
    granted: true,
    policyVersion: 1,
    mechanism: 'consent_widget_save',
    recordedAt: '2026-10-19T08:00:00Z',
  };

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(ANON_STORAGE_KEY, JSON.stringify([BROWSER_DECISION]));

    stubs = createStubs();
    configureGate(stubs);
    // The gate is constructed while the visitor is anonymous, so the
    // constructor's restore is the read that picks up the browser's decision.
    gate = TestBed.inject(ConsentGate);
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('writes nothing to the server when the read did not answer', () => {
    stubs.session.isAuthenticated.mockReturnValue(true);
    stubs.session.userId.mockReturnValue('user-uuid');
    stubs.api.effectiveConsent.mockReturnValue(throwError(() => new Error('the server did not answer')));

    gate.onSignIn('user-uuid');

    expect(
      stubs.api.recordConsentDecision,
      'a failed read wrote the browser decision to the server',
    ).not.toHaveBeenCalled();
    expect(
      localStorage.getItem(USER_STORAGE_KEY),
      'a failed read wrote to the signed-in cache',
    ).toBeNull();
  });

  it('leaves the effective state on the browser decision and surfaces the failure', () => {
    stubs.session.isAuthenticated.mockReturnValue(true);
    stubs.session.userId.mockReturnValue('user-uuid');
    stubs.api.effectiveConsent.mockReturnValue(throwError(() => new Error('the server did not answer')));

    gate.onSignIn('user-uuid');

    expect(
      gate.decisions().get('analytics')?.granted,
      'the browser decision stopped being the effective state',
    ).toBe(true);
    expect(gate.serverReadFailure(), 'the failed read was not surfaced').not.toBeNull();
    expect(stubs.errorHandler.handleError, 'the failed read was not reported').toHaveBeenCalled();
  });

  it('writes the browser decision when the server answered that it holds no records', () => {
    // The contrast: the same setup, the same browser decision, and the one
    // difference that matters — the server answered. Then the browser's
    // decision IS recorded, and the difference between the two states is
    // exactly the write.
    stubs.session.isAuthenticated.mockReturnValue(true);
    stubs.session.userId.mockReturnValue('user-uuid');
    stubs.api.effectiveConsent.mockReturnValue(of([]));

    gate.onSignIn('user-uuid');

    expect(
      stubs.api.recordConsentDecision,
      'the browser decision was not recorded on the server',
    ).toHaveBeenCalledWith('analytics', true, 'consent_widget_save');
    expect(localStorage.getItem(USER_STORAGE_KEY), 'the signed-in cache was not written').not.toBeNull();
    expect(gate.serverReadFailure(), 'a successful read was reported as a failure').toBeNull();
  });
});

/**
 * THE WHOLE CHAIN, OVER A MOCKED TRANSPORT.
 *
 * The two halves of this defect are one defect. The API service turned a
 * failed read into an empty list; the sign-in path reads an empty list as
 * "the server holds no records for this person"; and the rule for that is
 * "adopt the browser's decision AND WRITE IT TO THE SERVER". So the test
 * below uses the REAL API service over a mocked transport and asserts that
 * not one write is even attempted — because the log is append-only, and a
 * record written because a read failed could never be taken back.
 */
describe('ConsentGate — a failed read over the real API service', () => {
  let stubs: GateStubs;
  let gate: ConsentGate;
  let httpMock: HttpTestingController;

  /** The decision the person made in this browser, before signing in. */
  const BROWSER_DECISION = {
    purposeKey: 'analytics',
    granted: true,
    policyVersion: 1,
    mechanism: 'consent_widget_save',
    recordedAt: '2026-10-19T08:00:00Z',
  };

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(ANON_STORAGE_KEY, JSON.stringify([BROWSER_DECISION]));

    stubs = createStubs();

    TestBed.configureTestingModule({
      providers: [
        ConsentGate,
        { provide: SnippetInjector, useValue: stubs.injector },
        { provide: Session, useValue: stubs.session },
        { provide: ErrorHandler, useValue: stubs.errorHandler },
        { provide: PLATFORM_ID, useValue: 'browser' },
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });

    httpMock = TestBed.inject(HttpTestingController);
    gate = TestBed.inject(ConsentGate);
    // The catalogue is already loaded, so the only request this test has to
    // answer is the read of the subject's own records.
    gate.setMockConfig({ purposes: [PURPOSE_ANALYTICS] });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('does not attempt a single write when the read did not answer', () => {
    stubs.session.isAuthenticated.mockReturnValue(true);
    stubs.session.userId.mockReturnValue('user-uuid');

    gate.onSignIn('user-uuid');

    const read = httpMock.expectOne((r) => r.url === `${POSTGREST_BASE_URL}/consent_records`);
    read.flush('unavailable', { status: 503, statusText: 'Service Unavailable' });

    httpMock.expectNone(
      (r) => r.url === `${POSTGREST_BASE_URL}/rpc/record_consent_decision`,
    );
    expect(
      localStorage.getItem(USER_STORAGE_KEY),
      'a failed read wrote to the signed-in cache',
    ).toBeNull();
    expect(
      gate.decisions().get('analytics')?.granted,
      'the browser decision stopped being the effective state',
    ).toBe(true);
    expect(gate.serverReadFailure(), 'the failed read was not surfaced').not.toBeNull();
  });
});
