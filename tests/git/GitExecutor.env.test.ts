import { describe, it, expect, afterEach, vi } from 'vitest';
import { GitExecutor } from '@core/git/GitExecutor';

vi.mock('@core/utils/Logger', () => ({
  mainLogger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

/** Сообщения git — английские при любой локали юзера (их матчит классификатор). */
describe('GitExecutor.buildEnv', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });

  it('ставит LC_MESSAGES=C и убирает LANGUAGE', () => {
    process.env.LANG = 'ru_RU.UTF-8';
    process.env.LANGUAGE = 'ru';
    const env = GitExecutor.buildEnv();
    expect(env.LC_MESSAGES).toBe('C');
    expect(env.LANGUAGE).toBeUndefined();
    expect(env.LANG).toBe('ru_RU.UTF-8');
  });

  it('LC_ALL переносится в LC_CTYPE (иначе он перекрыл бы LC_MESSAGES)', () => {
    process.env.LC_ALL = 'ru_RU.UTF-8';
    const env = GitExecutor.buildEnv();
    expect(env.LC_ALL).toBeUndefined();
    expect(env.LC_CTYPE).toBe('ru_RU.UTF-8');
    expect(env.LC_MESSAGES).toBe('C');
  });

  it('extra env имеет приоритет', () => {
    const env = GitExecutor.buildEnv({ GIT_EDITOR: 'true' });
    expect(env.GIT_EDITOR).toBe('true');
  });
});
