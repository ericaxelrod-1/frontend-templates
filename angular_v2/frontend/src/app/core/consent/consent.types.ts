import type { components } from '../../api/schema';

export type ConsentPurpose = components['schemas']['consent_purposes'];
export type ConsentPageGroup = components['schemas']['consent_page_groups'];
export type ConsentTag = components['schemas']['consent_tags'];
export type ConsentTagGroup = components['schemas']['consent_tag_groups'];
export type ConsentRecord = components['schemas']['consent_records'];

/**
 * A client-side representation of a consent decision for a given purpose.
 */
export interface ConsentDecision {
  readonly purposeKey: string;
  readonly granted: boolean;
  readonly policyVersion: number;
  readonly mechanism: string;
  readonly recordedAt: string;
}

/**
 * The effective consent state: a map of purpose key to its latest decision.
 */
export type EffectiveConsentMap = ReadonlyMap<string, ConsentDecision>;
