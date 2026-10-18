import { TestBed } from '@angular/core/testing';
import { CodeLabelPipe } from './code-label';

const LABELS: Readonly<Record<string, string>> = { rtbf: 'erased at the member\'s request' };

describe('CodeLabelPipe', () => {
  let pipe: CodeLabelPipe;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [CodeLabelPipe] });
    pipe = TestBed.inject(CodeLabelPipe);
  });

  it('labels a member of the vocabulary', () => {
    expect(pipe.transform('rtbf', LABELS)).toBe('erased at the member\'s request');
  });

  /**
   * A constraint widened by a migration and not restated here must be VISIBLE. A
   * cell that quietly renders nothing reads as "no reason recorded", which is a
   * different and wrong fact about an account.
   */
  it('shows a code that is not in the vocabulary, with its raw value', () => {
    expect(pipe.transform('court_order', LABELS)).toBe('unrecognised code "court_order"');
  });

  /**
   * Absent and unrecognised must stay distinguishable, or a column the caller did
   * not read would render exactly like a column the database has no value for.
   */
  it('returns null for the absent case only', () => {
    expect(pipe.transform(null, LABELS)).toBeNull();
    expect(pipe.transform(undefined, LABELS)).toBeNull();
    expect(pipe.transform('', LABELS)).toBeNull();
  });
});