import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Активная запись «активности» в текущем async-контексте.
 * GitExecutor использует это, чтобы привязать выполненную команду к операции,
 * инициированной пользователем (push/pull/fetch/...) без явной передачи id.
 *
 * Фоновые вызовы git (status, log при refresh) идут вне этого контекста
 * и в журнал не попадают — так и задумано.
 */
const als = new AsyncLocalStorage<{ id: string }>();

export function runWithActivity<T>(id: string, fn: () => Promise<T>): Promise<T> {
  return als.run({ id }, fn);
}

export function getCurrentActivityId(): string | null {
  return als.getStore()?.id ?? null;
}
