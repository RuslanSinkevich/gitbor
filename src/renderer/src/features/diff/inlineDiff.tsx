import type { ReactNode } from 'react';
import s from './DiffView.module.css';

interface InlinePart {
  text: string;
  changed: boolean;
}

function commonPrefixLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) i++;
  return i;
}

function commonSuffixLength(a: string, b: string, prefix: number): number {
  const max = Math.min(a.length, b.length) - prefix;
  let i = 0;
  while (i < max && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
  return i;
}

function partsFor(text: string, prefix: number, suffix: number): InlinePart[] {
  const changedEnd = text.length - suffix;
  const parts: InlinePart[] = [];
  if (prefix > 0) parts.push({ text: text.slice(0, prefix), changed: false });
  if (changedEnd > prefix) parts.push({ text: text.slice(prefix, changedEnd), changed: true });
  if (suffix > 0) parts.push({ text: text.slice(changedEnd), changed: false });
  return parts;
}

export function inlineDiffParts(before: string, after: string): { before: InlinePart[]; after: InlinePart[] } {
  if (!before || !after || before === after) {
    return {
      before: [{ text: before, changed: false }],
      after: [{ text: after, changed: false }],
    };
  }

  const prefix = commonPrefixLength(before, after);
  const suffix = commonSuffixLength(before, after, prefix);
  return {
    before: partsFor(before, prefix, suffix),
    after: partsFor(after, prefix, suffix),
  };
}

export function renderInlineDiff(text: string, kind: 'add' | 'remove', compareTo?: string): ReactNode {
  if (compareTo === undefined) return text;
  const parts = kind === 'add'
    ? inlineDiffParts(compareTo, text).after
    : inlineDiffParts(text, compareTo).before;

  return parts.map((part, i) => part.changed ? (
    <span key={i} className={kind === 'add' ? s.inlineAddChange : s.inlineRemoveChange}>
      {part.text}
    </span>
  ) : part.text);
}
