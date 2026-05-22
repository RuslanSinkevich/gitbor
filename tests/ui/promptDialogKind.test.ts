import { describe, it, expectTypeOf } from 'vitest';
import type { ShowPromptOptions } from '../../src/renderer/src/ui/SgPromptDialog';

/**
 * Regression: confirmLabel больше НЕ переключает диалог в confirm-only режим.
 * Это контракт типов: `kind: 'confirm'` обязателен для confirm-варианта.
 */
describe('ShowPromptOptions discriminator', () => {
  it('input variant: confirmLabel может быть, kind опционален (дефолт input)', () => {
    expectTypeOf<{
      title: 'x';
      confirmLabel: 'Stash';
      onConfirm: (v: string) => void;
    }>().toMatchTypeOf<ShowPromptOptions>();
  });

  it('confirm variant: kind=confirm и onConfirm без аргументов', () => {
    expectTypeOf<{
      kind: 'confirm';
      title: 'x';
      onConfirm: () => void;
    }>().toMatchTypeOf<ShowPromptOptions>();
  });
});
