import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { OptionalStamp } from './optional-stamp';

describe('OptionalStamp', () => {
  let fixture: ComponentFixture<OptionalStamp>;

  function render(value: string | null, absentLabel?: string): string {
    fixture.componentRef.setInput('value', value);
    if (absentLabel !== undefined) {
      fixture.componentRef.setInput('absentLabel', absentLabel);
    }
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).textContent?.trim() ?? '';
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [OptionalStamp] }).compileComponents();
    fixture = TestBed.createComponent(OptionalStamp);
    fixture.detectChanges();
  });

  it('renders the instant, and exposes it as a machine-readable datetime', () => {
    render('2026-02-01T08:30:00.000Z');

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('time')?.getAttribute('datetime')).toBe('2026-02-01T08:30:00.000Z');
    expect(element.textContent).not.toBe('1970-01-01T00:00:00.000Z');
  });

  /**
   * An empty cell for a column that was never measured reads as an empty value.
   * The sentence is the caller's to choose, because a credential check and an
   * observation mean different things when there is none of either.
   */
  it('says the measurement was never taken, in the caller’s words', () => {
    expect(render(null, 'never observed')).toBe('never observed');
    expect(render(null, 'not verified')).toBe('not verified');
  });

  it('does not render a zero epoch for a NULL instant', () => {
    expect(render(null, 'never recorded')).not.toContain('1970');
  });
});