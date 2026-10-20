import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { Session } from '../../../core/auth/session.service';
import type { ProfileMe } from '../../profile/profile-me';
import { PrivacyApi } from '../privacy-api.service';
import type { EraseResponse } from '../privacy.types';
import { PrivacyPage } from './privacy-page';

class SessionStub {
  readonly databaseRole = signal<string | null>('app_member');
  readonly logout = vi.fn();
}

describe('PrivacyPage', () => {
  let fixture: ComponentFixture<PrivacyPage>;
  let api: {
    eraseSelf: ReturnType<typeof vi.fn>;
    myPrivacyState: ReturnType<typeof vi.fn>;
    purgeQueue: ReturnType<typeof vi.fn>;
  };
  let session: SessionStub;

  const mockProfile: ProfileMe = {
    id: '0192e210-9999-7000-8000-000000000001',
    username: 'alice',
    email: 'alice@example.com',
    created_at: '2026-03-01T12:00:00.000Z',
    first_name: 'Alice',
    last_name: 'Smith',
  };

  const mockOutcome: EraseResponse = {
    userId: '0192e210-9999-7000-8000-000000000001',
    alreadyErased: false,
    tombstoneAddress: 'deleted-7f8e9d@tombstone.local',
    anonymizedAt: '2026-10-19T22:30:00.000Z',
    pepperKid: 'v1',
  };

  beforeEach(async () => {
    session = new SessionStub();
    api = {
      eraseSelf: vi.fn().mockReturnValue(of(mockOutcome)),
      myPrivacyState: vi.fn().mockReturnValue(of(mockProfile)),
      purgeQueue: vi.fn().mockReturnValue(of([])),
    };

    await TestBed.configureTestingModule({
      imports: [PrivacyPage],
      providers: [
        provideRouter([]),
        { provide: Session, useValue: session },
        { provide: PrivacyApi, useValue: api },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PrivacyPage);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('renders what is erased and what is retained with statutory reasons', () => {
    const root = fixture.nativeElement as HTMLElement;

    expect(root.textContent).toContain('What is Erased Immediately');
    expect(root.textContent).toContain('What is Retained and Why');
    expect(root.textContent).toContain('11 CCR §7111');
    expect(root.textContent).toContain('11 CCR §7101(b)');
    expect(root.textContent).toContain('tombstone');
  });

  it('loads and displays current account privacy details', () => {
    const root = fixture.nativeElement as HTMLElement;

    expect(api.myPrivacyState).toHaveBeenCalled();
    expect(root.textContent).toContain('alice');
    expect(root.textContent).toContain('alice@example.com');
  });

  it('provides a self-service erasure button with confirmation flow', () => {
    const root = fixture.nativeElement as HTMLElement;
    const requestButton = Array.from(root.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Request Account Erasure'),
    );

    expect(requestButton).toBeDefined();

    // Click request button to open confirmation dialog
    requestButton?.click();
    fixture.detectChanges();

    expect(root.textContent).toContain('Are you absolutely sure you want to erase your account?');

    const confirmButton = Array.from(root.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Confirm & Erase My Account'),
    );
    expect(confirmButton).toBeDefined();

    confirmButton?.click();
    fixture.detectChanges();

    expect(api.eraseSelf).toHaveBeenCalled();
    expect(root.textContent).toContain('Account Erasure Succeeded');
    expect(root.textContent).toContain('deleted-7f8e9d@tombstone.local');
  });

  it('surfaces error if erasure fails', () => {
    api.eraseSelf.mockReturnValue(throwError(() => new Error('Email delivery failed')));

    const component = fixture.componentInstance;
    component['promptErasure']();
    fixture.detectChanges();

    component['executeErasure']();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Email delivery failed');
  });
});
