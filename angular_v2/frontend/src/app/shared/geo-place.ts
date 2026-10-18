import { DatePipe } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { CodeLabelPipe } from './code-label';

/**
 * `users.geo_source`, closed by a `CHECK` in `0012_user_geo.sql`.
 *
 * It is the PROVENANCE of the place next to it, which is why the page shows it:
 * "Berlin" derived from a geolocation lookup and "Berlin" typed in by the member
 * are two different claims about a person, and only one of them was checked by
 * anything.
 */
const GEO_SOURCE_LABELS: Readonly<Record<string, string>> = {
  geoip: 'from a geolocation lookup',
  user_declared: 'declared by the member',
  admin_verified: 'verified by an administrator',
};

/**
 * One coarse place with the provenance that makes it a claim rather than a fact.
 *
 * It is in `shared/` because two features render it: the Users page shows every
 * account's, and a member's profile shows their own. The alternative is the same
 * fifteen lines written twice, which is what AGENTS.md §F5 forbids.
 *
 * ## Why the radius is on the same line as the place
 *
 * `users.geo_accuracy_km` is a RADIUS in kilometres, and it is the difference
 * between two entirely different assertions. "Berlin ±12 km" is a metro area
 * guessed from an IP address; "Berlin ±12 m" is a point. Printing the city alone
 * — which is what a "Location" column does — renders them as the same sentence.
 *
 * So the radius is rendered in the unit that does not round it away: a
 * sub-kilometre claim is shown in metres, because `0.012` printed as a kilometre
 * figure is indistinguishable from "no idea" at the precision anyone actually
 * reads.
 *
 * ## The three absences are separate answers
 *
 * No place, no radius and no observation date are three different facts, and each
 * is rendered as its own line rather than collapsed into "unknown": a member who
 * has never given a city has no place and no radius, while an administrator who
 * verified one without a recorded radius has a place and no radius. Collapsing
 * them would make a missing measurement look like a missing location.
 */
@Component({
  selector: 'app-geo-place',
  standalone: true,
  imports: [CodeLabelPipe, DatePipe],
  templateUrl: './geo-place.html',
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 0.1rem;
    }

    .place {
      font: var(--mat-sys-body-medium);
    }

    .provenance,
    .radius,
    .absent {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
  `,
})
export class GeoPlace {
  /*
   * `| undefined` as well as `| null` because the two callers normalise
   * differently and neither is wrong: `ProfileMe` is the generated type, where an
   * absent column is `undefined`, and `UserListRow` is a view model where it is
   * `null`. Accepting both here means the cell does not care which convention the
   * row it is rendering happens to use.
   */
  readonly city = input<string | null | undefined>(undefined);
  readonly regionCode = input<string | null | undefined>(undefined);
  readonly countryCode = input<string | null | undefined>(undefined);
  readonly source = input<string | null | undefined>(undefined);
  readonly accuracyKm = input<number | null | undefined>(undefined);
  readonly updatedAt = input<string | null | undefined>(undefined);

  /** The `geo_source` vocabulary, exposed for the `codeLabel` pipe. */
  protected readonly sourceLabels = GEO_SOURCE_LABELS;

  protected readonly placeLabel = computed(() =>
    presentParts([this.city(), this.regionCode(), this.countryCode()]).join(', '),
  );

  protected readonly hasPlace = computed(() => this.placeLabel() !== '');

  protected readonly radius = computed(() => radiusClaim(this.accuracyKm()));
}

/** The non-blank parts, in the order they were given. Order is the readable one. */
function presentParts(values: readonly (string | null | undefined)[]): string[] {
  return values.filter(
    (value): value is string => typeof value === 'string' && value.trim() !== '',
  );
}

/**
 * The radius as a phrase, or `null` when none was recorded.
 *
 * `null` rather than an empty string so the caller can use `@if (radius(); as r)`
 * and get a real absent-state. The absence test is `null`/`undefined` and NOT a
 * truthiness test: a recorded `0` is a point, not a missing measurement, and
 * `@if (accuracyKm())` would collapse the two.
 */
function radiusClaim(accuracyKm: number | null | undefined): string | null {
  if (accuracyKm === null || accuracyKm === undefined) {
    return null;
  }
  if (accuracyKm === 0) {
    return 'a single point';
  }
  const metres = accuracyKm * 1000;
  return metres < 1000 ? `within ${trim(metres)} m` : `within ${trim(accuracyKm)} km`;
}

/**
 * Up to three decimal places with no trailing zeros, so `12` prints `12` and
 * `0.0125` prints `0.013`. `toFixed` alone would give `12.000`, which reads as a
 * spurious precision claim about a measurement that is a radius to the nearest
 * kilometre.
 */
function trim(value: number): string {
  return Number.parseFloat(value.toFixed(3)).toString();
}