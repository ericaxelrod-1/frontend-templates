import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Session } from '../../../core/auth/session.service';
import { ConsentGate } from '../../../core/consent/consent-gate.service';
import type { ConsentPurpose } from '../../../core/consent/consent.types';
import { ConsentWidget } from './consent-widget';

describe('ConsentWidget', () => {
  let sessionStub: { isAuthenticated: ReturnType<typeof vi.fn> };
  let gateStub: {
    consentRequiredPurposes: ReturnType<typeof signal<readonly ConsentPurpose[]>>;
    decisions: ReturnType<typeof signal<ReadonlyMap<string, { purposeKey: string; granted: boolean }>>>;
    needsReprompt: ReturnType<typeof signal<boolean>>;
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
});
