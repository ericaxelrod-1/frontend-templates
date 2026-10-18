import { Pipe, type PipeTransform } from '@angular/core';
import type { JsonbEntry } from './security-telemetry.types';

/**
 * Turns a PostgREST `jsonb` value (`evidence`, `alert_data`, `geo_location`,
 * `statistics`, `metadata`) into human-readable key/value pairs so templates
 * never dump raw JSON strings.
 */
@Pipe({
  name: 'jsonbEntries',
  standalone: true,
})
export class JsonbEntriesPipe implements PipeTransform {
  transform(value: unknown): readonly JsonbEntry[] {
    return toJsonbEntries(value);
  }
}

export function toJsonbEntries(value: unknown): readonly JsonbEntry[] {
  if (value === null || value === undefined) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => ({
      key: `#${index + 1}`,
      value: formatJsonbScalar(item),
    }));
  }
  if (typeof value === 'object') {
    const entries: JsonbEntry[] = [];
    for (const [rawKey, rawVal] of Object.entries(value as Record<string, unknown>)) {
      if (rawVal !== undefined) {
        entries.push({
          key: humanizeKey(rawKey),
          value: formatJsonbScalar(rawVal),
        });
      }
    }
    return entries;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return [{ key: 'value', value: String(value) }];
  }
  return [];
}

function humanizeKey(key: string): string {
  return key.replace(/_/g, ' ');
}

function formatJsonbScalar(value: unknown): string {
  if (value === null || value === undefined) {
    return 'none';
  }
  if (typeof value === 'boolean') {
    return value ? 'yes' : 'no';
  }
  if (typeof value === 'number' || typeof value === 'string') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.length === 0 ? 'none' : value.map((item) => formatJsonbScalar(item)).join(', ');
  }
  if (typeof value === 'object') {
    const parts = Object.entries(value as Record<string, unknown>).map(
      ([k, v]) => `${humanizeKey(k)}: ${formatJsonbScalar(v)}`,
    );
    return parts.length === 0 ? 'none' : parts.join('; ');
  }
  return 'none';
}
