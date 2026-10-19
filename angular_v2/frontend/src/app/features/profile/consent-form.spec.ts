import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ConsentGate } from '../../core/consent/consent-gate.service';
import type { ConsentPurpose } from '../../core/consent/consent.types';
import { ProfileConsentForm } from './consent-form';

describe('ProfileConsentForm', () => {
  let gateStub: {
    consentRequiredPurposes: ReturnType<typeof signal<readonly ConsentPurpose[]>>;
    decisions: ReturnType<typeof signal<ReadonlyMap<string, { purposeKey: string; granted: boolean; policyVersion: number; mechanism: string; recordedAt: string }>>>;
    repromptPurposes: ReturnType<typeof signal<readonly ConsentPurpose[]>>;
    writeFailure: ReturnType<typeof signal<string | null>>;
    configFailure: ReturnType<typeof signal<string | null>>;
    storageFailure: ReturnType<typeof signal<string | null>>;
    serverReadFailure: ReturnType<typeof signal<string | null>>;
    setDecision: ReturnType<typeof vi.fn>;
    setDecisions: ReturnType<typeof vi.fn>;
  };

  const MOCK_PURPOSES: ConsentPurpose[] = [
    {
      id: '1',
      key: 'analytics',
      label: 'Analytics Tracking',
      description: 'Metrics and telemetry',
      legal_basis: 'consent',
      requires_consent: true,
      policy_version: 2,
      sort_order: 1,
      created_at: '',
      updated_at: '',
    },
  ];

  beforeEach(async () => {
    gateStub = {
      consentRequiredPurposes: signal(MOCK_PURPOSES),
      decisions: signal(
        new Map([
          [
            'analytics',
            {
              purposeKey: 'analytics',
              granted: true,
              policyVersion: 1,
              mechanism: 'settings',
              recordedAt: '2026-10-19T00:00:00Z',
            },
          ],
        ]),
      ),
      repromptPurposes: signal(MOCK_PURPOSES.slice(0, 1)),
      writeFailure: signal<string | null>(null),
      configFailure: signal<string | null>(null),
      storageFailure: signal<string | null>(null),
      serverReadFailure: signal<string | null>(null),
      setDecision: vi.fn(),
      setDecisions: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [ProfileConsentForm],
      providers: [{ provide: ConsentGate, useValue: gateStub }],
    }).compileComponents();
  });

  it('renders purposes with legal basis and reprompt notice when policy_version was bumped', () => {
    const fixture = TestBed.createComponent(ProfileConsentForm);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const text = root.textContent;
    expect(text).toContain('Analytics Tracking');
    expect(text).toContain('Legal basis: consent');
    expect(text).toContain('The policy for this processing was updated to version 2');
  });

  it('allows withdrawal as easily as granting', () => {
    const fixture = TestBed.createComponent(ProfileConsentForm);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('button'));
    const withdrawBtn = buttons.find((b) => b.textContent?.trim() === 'Withdraw');
    expect(withdrawBtn).toBeDefined();

    withdrawBtn?.click();
    fixture.detectChanges();

    expect(gateStub.setDecision).toHaveBeenCalledWith('analytics', false, 'profile_settings');
  });

  it('allows granting all choices with single action', () => {
    const fixture = TestBed.createComponent(ProfileConsentForm);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('button'));
    const grantAllBtn = buttons.find((b) => b.textContent?.trim() === 'Grant all');
    expect(grantAllBtn).toBeDefined();

    grantAllBtn?.click();
    fixture.detectChanges();

    expect(gateStub.setDecisions).toHaveBeenCalledWith(
      [{ purposeKey: 'analytics', granted: true }],
      'profile_settings_grant_all',
    );
  });

  it('tells the person their choice was not recorded, and does not claim it was', () => {
    // The failure of a write has to be visible HERE, because this is where a
    // signed-in person records a decision. And the "recorded at" line must not
    // stand next to it: it would say the opposite of the truth.
    gateStub.writeFailure.set('Your choice was not recorded. Please try again — nothing has been saved.');

    const fixture = TestBed.createComponent(ProfileConsentForm);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const text = root.textContent ?? '';
    expect(text).toContain('Your choice was not recorded');
    expect(text).not.toContain('Your choices were recorded at');

    // Announced as an alert, so it reaches a screen reader too. The reprompt
    // notice is an alert as well, so the assertion is that ONE of the alerts
    // carries the failure — not that the first one does.
    const alerts = Array.from(root.querySelectorAll('[role="alert"]')).map((element) => element.textContent ?? '');
    expect(
      alerts.some((alert) => alert.includes('not recorded')),
      'no alert tells the person their choice was not recorded',
    ).toBe(true);
  });

  it('states a catalogue that could not be loaded, and offers no grant that grants nothing', () => {
    // The failure has to be visible HERE: this is where a signed-in person
    // manages their consent. And a form whose "Grant all" grants nothing is
    // a button that looks finished and is not (AGENTS.md §2.1).
    gateStub.configFailure.set(
      'The list of purposes this site would ask you about could not be loaded, so your choices cannot be shown or saved.',
    );
    gateStub.consentRequiredPurposes.set([]);

    const fixture = TestBed.createComponent(ProfileConsentForm);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const text = root.textContent ?? '';
    expect(text).toContain('could not be loaded');

    const alerts = Array.from(root.querySelectorAll('[role="alert"]')).map((element) => element.textContent ?? '');
    expect(
      alerts.some((alert) => alert.includes('could not be loaded')),
      'no alert states the failed catalogue load',
    ).toBe(true);

    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('button'));
    expect(buttons, 'the form offered a grant that grants nothing').toHaveLength(0);
  });

  it('states a decision this browser could not keep, and a server that did not answer', () => {
    gateStub.storageFailure.set(
      'Your privacy choice could not be saved in this browser, so it will not be remembered on this device.',
    );
    gateStub.serverReadFailure.set(
      'Your saved consent choices could not be read from the server, so the choices shown here are the ones stored in this browser.',
    );

    const fixture = TestBed.createComponent(ProfileConsentForm);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const text = root.textContent ?? '';
    expect(text).toContain('could not be saved in this browser');
    expect(text).toContain('could not be read from the server');
  });
});
