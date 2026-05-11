import { vi, type Mock } from 'vitest';
import type { OperationResult } from '../../src/core/git/types';
import type { SafetyNet } from '../../src/core/safety/SafetyNet';

/**
 * Mock `SafetyNet.wrapDestructive`: проксирует операцию, возвращая
 * фейковый OperationResult. По умолчанию success=true, rollback=true.
 * Реальная snapshot/rollback-логика в тестах команд не проверяется.
 */
export interface MockSafety {
  wrapDestructive: Mock<SafetyNet['wrapDestructive']>;
}

export function makeMockSafety(): MockSafety {
  return {
    wrapDestructive: vi.fn(
      async <T>(
        _op: string,
        _params: Record<string, string>,
        operation: () => Promise<T>,
      ): Promise<OperationResult<T>> => {
        const data = await operation();
        return { success: true, data, rollbackAvailable: true };
      },
    ),
  };
}
