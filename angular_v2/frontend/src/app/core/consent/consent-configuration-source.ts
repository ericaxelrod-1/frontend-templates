import { inject, Injectable } from '@angular/core';
import { forkJoin, type Observable } from 'rxjs';
import { ConsentApi } from './consent-api.service';
import type {
  ConsentPageGroup,
  ConsentPurpose,
  ConsentTag,
  ConsentTagGroup,
} from './consent.types';

/**
 * The whole consent catalogue, as ONE value.
 *
 * The four collections are read together and are only meaningful together: a
 * purpose without its page groups and tags describes nothing that can be
 * injected, and a tag without its purposes cannot be gated. So they travel as
 * one value rather than as four, and a caller cannot hold half a catalogue.
 */
export type ConsentConfiguration = {
  readonly purposes: readonly ConsentPurpose[];
  readonly pageGroups: readonly ConsentPageGroup[];
  readonly tags: readonly ConsentTag[];
  readonly tagGroups: readonly ConsentTagGroup[];
};

/**
 * WHERE THE CATALOGUE COMES FROM.
 *
 * ## Why this is a class and not a function the gate calls
 *
 * The gate used to call `ConsentApi` directly, and its own suite injected a
 * fake `ConsentApi` to get a catalogue without a network. That worked, and it
 * also meant the gate's test seam was a whole API surface: the fake had to
 * answer four reads, and every test that wanted a catalogue had to build one.
 *
 * **It also meant the gate had a method whose only purpose was to let a test
 * fake a configuration** — `setMockConfig` — which is a mock service in
 * application code (`AGENTS.md` §2.2: a method whose only reason to exist is a
 * test's convenience is a test's convenience shipped to production).
 *
 * So the catalogue now arrives through ONE injected source, and the gate does
 * not know what a test is: it asks the source for the configuration, and the
 * source is what a test replaces. **The mock lives on the test's side of the
 * boundary, and there is exactly one mechanism** (§2.4).
 *
 * ## Why the source is a class and not an interface
 *
 * Angular's dependency injection needs a token, and a class is a token that
 * cannot be faked by accident. The production implementation is this class;
 * `ConsentApi` stays the thing that knows about PostgREST and about the four
 * endpoints, and this file is the one place that says "the catalogue is these
 * four reads, together".
 */
@Injectable({ providedIn: 'root' })
export class ConsentConfigurationSource {
  private readonly api = inject(ConsentApi);

  /**
   * The catalogue, as one value.
   *
   * **The failure propagates.** A catalogue that cannot be fetched is a
   * MISCONFIGURATION OF THE DEPLOYMENT, and the gate reports it (`configFailure`)
   * and continues with an empty catalogue, which injects nothing. Swallowing it
   * here would turn "the deployment is misconfigured" into "this deployment has
   * no analytics" — the one state an operator needs to distinguish
   * (`AGENTS.md` §2.3).
   */
  load(): Observable<ConsentConfiguration> {
    return forkJoin({
      purposes: this.api.purposes(),
      pageGroups: this.api.pageGroups(),
      tags: this.api.tags(),
      tagGroups: this.api.tagGroups(),
    });
  }
}
