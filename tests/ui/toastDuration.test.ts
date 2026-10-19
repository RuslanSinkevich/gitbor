import { describe, it, expect } from 'vitest';
import { toastDuration } from '../../src/renderer/src/ui/SgToast';

/** Время жизни тоста — по тому, сколько нужно человеку на чтение и решение. */
describe('toastDuration', () => {
  const action = { label: 'Повторить', onClick: () => {} };

  it('«готово» и info — коротко', () => {
    expect(toastDuration({ type: 'success' })).toBe(4_000);
    expect(toastDuration({})).toBe(4_000);
  });

  it('ошибку успевают прочитать, с кнопкой — ещё и решить', () => {
    expect(toastDuration({ type: 'error' })).toBe(10_000);
    expect(toastDuration({ type: 'error', action })).toBe(20_000);
  });

  it('тост с кнопкой больше не висит вечно', () => {
    expect(Number.isFinite(toastDuration({ type: 'warning', action }))).toBe(true);
  });

  it('явный duration важнее правил', () => {
    expect(toastDuration({ type: 'error', action, duration: 3_000 })).toBe(3_000);
  });
});
