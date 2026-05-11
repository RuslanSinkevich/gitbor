import { vi, type Mock } from 'vitest';
import type { OperationQueue } from '../../src/core/safety/OperationQueue';

/**
 * Минимальный mock `OperationQueue`: enqueueWrite/enqueueRead просто
 * выполняют переданную функцию синхронно (без реальной очереди). Тестам
 * write-команд не интересна сериализация, а только то, что нужный label
 * передан и операция действительно вызвана.
 */
export interface MockQueue {
  enqueueWrite: Mock<OperationQueue['enqueueWrite']>;
  enqueueRead: Mock<OperationQueue['enqueueRead']>;
  onStatusChange?: Mock<OperationQueue['onStatusChange']>;
}

export function makeMockQueue(): MockQueue {
  return {
    enqueueWrite: vi.fn(async <T>(_label: string, op: () => Promise<T>) => op()),
    enqueueRead: vi.fn(async <T>(_label: string, op: () => Promise<T>) => op()),
    onStatusChange: vi.fn(() => () => {}),
  };
}
