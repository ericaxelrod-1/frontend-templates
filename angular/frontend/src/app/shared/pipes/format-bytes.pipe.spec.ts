import { FormatBytesPipe } from './format-bytes.pipe';

describe('FormatBytesPipe', () => {
  const pipe = new FormatBytesPipe();

  it('renders a zero or absent figure without producing NaN', () => {
    expect(pipe.transform(0)).toBe('0 Bytes');
    expect(pipe.transform(null)).toBe('0 Bytes');
    expect(pipe.transform(undefined)).toBe('0 Bytes');
    expect(pipe.transform(Number.NaN)).toBe('0 Bytes');
    expect(pipe.transform(-1)).toBe('0 Bytes');
  });

  it('scales each unit', () => {
    expect(pipe.transform(512)).toBe('512 Bytes');
    expect(pipe.transform(1024)).toBe('1 KB');
    expect(pipe.transform(1024 * 1024)).toBe('1 MB');
    expect(pipe.transform(1024 * 1024 * 1024)).toBe('1 GB');
  });

  it('keeps two decimal places', () => {
    expect(pipe.transform(1536)).toBe('1.5 KB');
  });

  it('clamps past the last unit instead of indexing off the end', () => {
    expect(pipe.transform(1024 ** 6)).toContain('PB');
  });
});