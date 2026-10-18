import { JsonbEntriesPipe } from './jsonb-entries.pipe';

describe('JsonbEntriesPipe', () => {
  const pipe = new JsonbEntriesPipe();

  it('returns an empty list for null or undefined jsonb values', () => {
    expect(pipe.transform(null)).toEqual([]);
    expect(pipe.transform(undefined)).toEqual([]);
  });

  it('converts an object payload into readable key/value entries without raw JSON punctuation', () => {
    const entries = pipe.transform({
      window_seconds: 900,
      sample_usernames: ['admin', 'alice'],
      threshold_exceeded: true,
    });

    expect(entries).toEqual([
      { key: 'window seconds', value: '900' },
      { key: 'sample usernames', value: 'admin, alice' },
      { key: 'threshold exceeded', value: 'yes' },
    ]);
  });
});
