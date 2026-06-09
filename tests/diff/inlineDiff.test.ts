import { describe, expect, it } from 'vitest';
import { inlineDiffParts } from '../../src/renderer/src/features/diff/inlineDiff';

describe('inlineDiffParts', () => {
  it('marks the changed middle part', () => {
    expect(inlineDiffParts('const a = 1;', 'const a = 2;')).toEqual({
      before: [
        { text: 'const a = ', changed: false },
        { text: '1', changed: true },
        { text: ';', changed: false },
      ],
      after: [
        { text: 'const a = ', changed: false },
        { text: '2', changed: true },
        { text: ';', changed: false },
      ],
    });
  });

  it('marks replacements near the end', () => {
    expect(inlineDiffParts('return foo;', 'return bar;')).toEqual({
      before: [
        { text: 'return ', changed: false },
        { text: 'foo', changed: true },
        { text: ';', changed: false },
      ],
      after: [
        { text: 'return ', changed: false },
        { text: 'bar', changed: true },
        { text: ';', changed: false },
      ],
    });
  });

  it('does not mark equal lines', () => {
    expect(inlineDiffParts('same', 'same')).toEqual({
      before: [{ text: 'same', changed: false }],
      after: [{ text: 'same', changed: false }],
    });
  });
});
