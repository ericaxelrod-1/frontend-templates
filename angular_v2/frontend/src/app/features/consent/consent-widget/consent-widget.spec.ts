import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { Session } from '../../../core/auth/session.service';
import { ConsentApi } from '../../../core/consent/consent-api.service';
import { ConsentConfigurationSource } from '../../../core/consent/consent-configuration-source';
import { ConsentGate } from '../../../core/consent/consent-gate.service';
import type { ConsentPurpose } from '../../../core/consent/consent.types';
import { SnippetInjector } from '../../../core/consent/snippet-injector.service';
import { ConsentWidget } from './consent-widget';

describe('ConsentWidget', () => {
  let sessionStub: { isAuthenticated: ReturnType<typeof vi.fn> };
  let gateStub: {
    consentRequiredPurposes: ReturnType<typeof signal<readonly ConsentPurpose[]>>;
    decisions: ReturnType<typeof signal<ReadonlyMap<string, { purposeKey: string; granted: boolean }>>>;
    needsReprompt: ReturnType<typeof signal<boolean>>;
    configFailure: ReturnType<typeof signal<string | null>>;
    storageFailure: ReturnType<typeof signal<string | null>>;
    setDecisions: ReturnType<typeof vi.fn>;
  };

  const MOCK_PURPOSES: ConsentPurpose[] = [
    {
      id: '1',
      key: 'analytics',
      label: 'Analytics Tracking',
      description: 'Collects page view metrics',
      legal_basis: 'consent',
      requires_consent: true,
      policy_version: 1,
      sort_order: 1,
      created_at: '',
      updated_at: '',
    },
    {
      id: '2',
      key: 'marketing',
      label: 'Marketing & Ads',
      description: 'Remarketing cookies',
      legal_basis: 'consent',
      requires_consent: true,
      policy_version: 1,
      sort_order: 2,
      created_at: '',
      updated_at: '',
    },
  ];

  beforeEach(async () => {
    sessionStub = {
      isAuthenticated: vi.fn().mockReturnValue(false),
    };

    gateStub = {
      consentRequiredPurposes: signal<readonly ConsentPurpose[]>(MOCK_PURPOSES),
      decisions: signal(new Map()),
      needsReprompt: signal(false),
      configFailure: signal<string | null>(null),
      storageFailure: signal<string | null>(null),
      setDecisions: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [ConsentWidget],
      providers: [
        { provide: Session, useValue: sessionStub },
        { provide: ConsentGate, useValue: gateStub },
        { provide: PLATFORM_ID, useValue: 'browser' },
      ],
    }).compileComponents();
  });

  it('renders on public pages for unauthenticated visitors', () => {
    sessionStub.isAuthenticated.mockReturnValue(false);
    const fixture = TestBed.createComponent(ConsentWidget);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const trigger = root.querySelector('.consent-trigger');
    expect(trigger).not.toBeNull();
  });

  it('is NOT rendered when the visitor is authenticated', () => {
    sessionStub.isAuthenticated.mockReturnValue(true);
    const fixture = TestBed.createComponent(ConsentWidget);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const trigger = root.querySelector('.consent-trigger');
    expect(trigger).toBeNull();
  });

  it('opens modal, lists non-essential purposes, and records choices on accept all', () => {
    const fixture = TestBed.createComponent(ConsentWidget);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;

    // Click trigger to open modal
    const trigger = root.querySelector<HTMLButtonElement>('.consent-trigger');
    trigger?.click();
    fixture.detectChanges();

    const card = root.querySelector('.consent-card');
    expect(card).not.toBeNull();
    expect(root.textContent).toContain('Analytics Tracking');
    expect(root.textContent).toContain('Marketing & Ads');

    // Click Accept All
    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('button'));
    const acceptAllBtn = buttons.find((b) => b.textContent?.includes('Accept all'));
    expect(acceptAllBtn).toBeDefined();
    acceptAllBtn?.click();
    fixture.detectChanges();

    expect(gateStub.setDecisions).toHaveBeenCalledWith(
      [
        { purposeKey: 'analytics', granted: true },
        { purposeKey: 'marketing', granted: true },
      ],
      'consent_widget_accept_all',
    );
  });

  it('states a catalogue that could not be loaded, and offers no choice it cannot record', () => {
    // A widget that quietly shows an empty list reads as "you have no
    // choices" — the opposite of the truth. So the failure is stated on the
    // widget, and the "Accept all" that would record nothing is not offered.
    gateStub.configFailure.set(
      'The list of purposes this site would ask you about could not be loaded, so your choices cannot be shown or saved.',
    );
    gateStub.consentRequiredPurposes.set([]);

    const fixture = TestBed.createComponent(ConsentWidget);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;

    // Stated without the visitor having to open anything.
    expect(root.textContent).toContain('could not be loaded');
    expect(root.querySelector('[role="alert"]'), 'the failure was not announced').not.toBeNull();

    // And the modal does not present an empty list with buttons that record
    // nothing.
    const trigger = root.querySelector<HTMLButtonElement>('.consent-trigger');
    trigger?.click();
    fixture.detectChanges();

    expect(root.textContent).toContain('could not be loaded');
    const actions = root.querySelectorAll('.global-actions button');
    expect(actions.length, 'the widget offered choices it cannot record').toBe(0);
  });

  it('states a choice that could not be saved in this browser', () => {
    gateStub.storageFailure.set(
      'Your privacy choice could not be saved in this browser, so it will not be remembered on this device.',
    );

    const fixture = TestBed.createComponent(ConsentWidget);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;

    expect(root.textContent).toContain('could not be saved in this browser');
  });

  /**
   * THE RE-PROMPT.
   *
   * The branch used to be a constructor check — `if (this.gate.needsReprompt())` —
   * and it could never fire, because a re-prompt is a question about the
   * CATALOGUE and the catalogue is fetched asynchronously. These two cases are
   * the branch working and the branch not firing when it should not.
   */
  it('opens the modal by itself when the visitor needs to be re-prompted', () => {
    const fixture = TestBed.createComponent(ConsentWidget);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.consent-card'), 'the modal opened on its own').toBeNull();

    // The condition becomes true LATER — which is the whole point: a check made
    // once, at construction, could not have seen it.
    gateStub.needsReprompt.set(true);
    fixture.detectChanges();

    expect(root.querySelector('.consent-card'), 'the re-prompt did not open the modal').not.toBeNull();
  });

  it('does not open the modal when nobody needs to be asked', () => {
    const fixture = TestBed.createComponent(ConsentWidget);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.consent-card')).toBeNull();
  });

  it('does not re-open a modal that is already open, so staged choices are not thrown away', () => {
    const fixture = TestBed.createComponent(ConsentWidget);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const trigger = root.querySelector<HTMLButtonElement>('.consent-trigger');
    trigger?.click();
    fixture.detectChanges();
    expect(root.querySelector('.consent-card')).not.toBeNull();

    // The visitor is already being asked; re-opening would re-stage from the
    // committed decisions and silently discard what they had staged.
    gateStub.needsReprompt.set(true);
    fixture.detectChanges();

    expect(root.querySelector('.consent-card')).not.toBeNull();
  });
});

/**
 * THE SAME BRANCH, WITH THE REAL GATE.
 *
 * The cases above drive the widget with a stubbed gate, so they prove the
 * widget's behaviour and not the GATE's. This one is the proof of the CAUSE:
 * with the real gate, the catalogue is fetched asynchronously, so at the moment
 * the widget is constructed there is no catalogue, there are no purposes, and
 * `needsReprompt()` is false — and a constructor check against that value can
 * never fire, however true it becomes a moment later.
 */
describe('ConsentWidget — the re-prompt, with the real gate', () => {
  const CATALOGUE_PURPOSE: ConsentPurpose = {
    id: '1',
    key: 'analytics',
    label: 'Analytics Tracking',
    description: 'Collects page view metrics',
    legal_basis: 'consent',
    requires_consent: true,
    policy_version: 1,
    sort_order: 1,
    created_at: '',
    updated_at: '',
  };

  beforeEach(async () => {
    localStorage.clear();

    await TestBed.configureTestingModule({
      imports: [ConsentWidget],
      providers: [
        {
          provide: Session,
          useValue: {
            isAuthenticated: vi.fn().mockReturnValue(false),
            userId: vi.fn().mockReturnValue(null),
          },
        },
        { provide: SnippetInjector, useValue: { inject: vi.fn() } },
        { provide: ConsentApi, useValue: {} },
        {
          provide: ConsentConfigurationSource,
          useValue: {
            load: () =>
              of({
                purposes: [CATALOGUE_PURPOSE],
                pageGroups: [],
                tags: [],
                tagGroups: [],
              }),
          },
        },
        { provide: PLATFORM_ID, useValue: 'browser' },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('asks the visitor once the catalogue has arrived, which is what the constructor could not do', async () => {
    const gate = TestBed.inject(ConsentGate);
    const fixture = TestBed.createComponent(ConsentWidget);
    fixture.detectChanges();

    // The catalogue has NOT arrived: the gate fetches it, and a fetch has not
    // finished. So there is no purpose, nothing to be asked about, and the
    // re-prompt condition is false — exactly the state the old constructor check
    // sampled, and the reason it could never fire.
    expect(gate.purposes().length, 'the catalogue arrived before it was fetched').toBe(0);
    expect(gate.needsReprompt(), 'there was something to ask about before the catalogue arrived').toBe(false);

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.consent-card')).toBeNull();

    // Now it arrives, and the answer changes.
    await gate.ensureConfiguration();
    fixture.detectChanges();

    expect(gate.needsReprompt(), 'a purpose nobody was asked about is not a re-prompt').toBe(true);
    expect(root.querySelector('.consent-card'), 'the visitor was never asked').not.toBeNull();
  });
});
