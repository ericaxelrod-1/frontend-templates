/** One rendered `jsonb` key/value pair, produced by `JsonbEntriesPipe`. */
export interface JsonbEntry {
  readonly key: string;
  readonly value: string;
}