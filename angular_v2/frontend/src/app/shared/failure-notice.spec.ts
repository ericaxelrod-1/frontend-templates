import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { FailureNotice } from './failure-notice';

describe('FailureNotice', () => {
  let fixture: ComponentFixture<FailureNotice>;

  function given(messages: readonly string[]): void {
    fixture.componentRef.setInput('messages', messages);
    fixture.detectChanges();
  }

  function root(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [FailureNotice] }).compileComponents();
    fixture = TestBed.createComponent(FailureNotice);
  });

  it('states every message it is given', () => {
    given(['The list of purposes could not be loaded.', 'Nothing has been tracked.']);

    const text = root().textContent ?? '';
    expect(text).toContain('The list of purposes could not be loaded.');
    expect(text).toContain('Nothing has been tracked.');
  });

  it('announces the failures as one region, so a failure that arrives late reaches the page', () => {
    given(['The list of purposes could not be loaded.']);

    // The failure usually arrives after the page has loaded — the catalogue is
    // fetched — so the region has to be a live region, not static text.
    const region = root().querySelector('[role="alert"]');
    expect(region, 'the failure was not announced').not.toBeNull();
    expect(region?.textContent).toContain('could not be loaded');
  });

  it('states nothing at all when there is nothing to state', () => {
    given([]);

    expect(root().textContent?.trim() ?? '').toBe('');
  });
});
