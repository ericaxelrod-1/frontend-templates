import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { GeoPlace } from './geo-place';

describe('GeoPlace', () => {
  let fixture: ComponentFixture<GeoPlace>;

  /** Set an input by name, from a plain record so each test reads as data. */
  function given(values: Record<string, string | number | null | undefined>): void {
    fixture.componentRef.setInput('city', null);
    for (const [name, value] of Object.entries(values)) {
      fixture.componentRef.setInput(name, value);
    }
    fixture.detectChanges();
  }

  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [GeoPlace] }).compileComponents();
    fixture = TestBed.createComponent(GeoPlace);
    fixture.detectChanges();
  });

  /**
   * The reason this component exists at all: a "Berlin" with a 12 km radius and a
   * "Berlin" with a 12 m radius are different claims, and a Location column that
   * printed the city alone would make them the same sentence.
   */
  it('shows the place with the radius that bounds it', () => {
    given({ city: 'Berlin', regionCode: 'BE', countryCode: 'DE', accuracyKm: 12, source: 'geoip' });

    expect(text()).toContain('Berlin, BE, DE');
    expect(text()).toContain('within 12 km');
  });

  it('shows a sub-kilometre radius in metres rather than rounding it away', () => {
    given({ city: 'Berlin', accuracyKm: 0.012, source: 'geoip' });

    expect(text()).toContain('within 12 m');
    // The whole point: 0.012 km printed as a kilometre figure is unreadable, and it
    // would be indistinguishable from a measurement nobody took.
    expect(text()).not.toContain('km');
  });

  it('describes a recorded radius of zero as a point, not as a missing one', () => {
    given({ city: 'Berlin', accuracyKm: 0, source: 'admin_verified' });

    expect(text()).toContain('a single point');
  });

  it('names where the place came from', () => {
    given({ city: 'Berlin', source: 'user_declared' });

    expect(text()).toContain('declared by the member');
  });

  it('shows an unrecognised source rather than an empty claim', () => {
    given({ city: 'Berlin', source: 'carrier-lookup' });

    expect(text()).toContain('unrecognised code "carrier-lookup"');
  });

  /**
   * Three absences, three sentences. Collapsing them would make a missing radius
   * look like a missing location.
   */
  it('distinguishes no place from a place with no radius and no date', () => {
    given({ city: null, regionCode: null, countryCode: null });

    expect(text()).toBe('no place recorded');
  });

  it('says the radius is unrecorded without denying that the place is', () => {
    given({ city: 'Berlin', accuracyKm: null });

    expect(text()).toContain('Berlin');
    expect(text()).toContain('radius not recorded');
    expect(text()).toContain('source not recorded');
    expect(text()).toContain('observation date not recorded');
  });

  it('shows when the place was observed', () => {
    given({ city: 'Berlin', updatedAt: '2026-02-03T19:12:00.000Z' });

    expect(text()).toContain('observed');
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain(
      'observation date not recorded',
    );
  });

  it('accepts absent columns as undefined as well as null, because the two row types differ', () => {
    given({ city: 'Berlin', accuracyKm: undefined, updatedAt: undefined });

    expect(text()).toContain('radius not recorded');
  });
});