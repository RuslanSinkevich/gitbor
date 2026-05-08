import { describe, it, expect } from 'vitest';
import { AppError } from '../../src/core/utils/AppError';

/**
 * AppError — структурированная ошибка для прокидывания локализационного
 * кода через IPC. Тесты следят, что:
 * - `code` и `data` сохраняются;
 * - `message` = fallback (если задан) или = code (для обратной совместимости);
 * - `name` = 'AppError' (для проверок `error.name === 'AppError'`);
 * - наследует Error → `instanceof Error` true → catch-блоки её ловят.
 */
describe('AppError', () => {
  it('keeps code and data', () => {
    const e = new AppError('repoErrors.notARepo', { path: '/foo' });
    expect(e.code).toBe('repoErrors.notARepo');
    expect(e.data).toEqual({ path: '/foo' });
  });

  it('uses fallback as message when provided', () => {
    const e = new AppError('repoErrors.notARepo', { path: '/x' }, 'Not a Git repository: /x');
    expect(e.message).toBe('Not a Git repository: /x');
  });

  it('falls back to code as message when no fallback given', () => {
    const e = new AppError('repoErrors.invalidPath');
    expect(e.message).toBe('repoErrors.invalidPath');
  });

  it('defaults data to empty object', () => {
    const e = new AppError('some.code');
    expect(e.data).toEqual({});
  });

  it('is a real Error instance with name = AppError', () => {
    const e = new AppError('x.y');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('AppError');
  });

  it('is catchable as Error', () => {
    let caught: unknown;
    try {
      throw new AppError('repoErrors.notARepo', { path: '/p' }, 'fb');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).code).toBe('repoErrors.notARepo');
  });
});
