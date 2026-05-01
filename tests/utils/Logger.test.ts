import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Logger контракт: уровни фильтруют сообщения, ERROR/WARN идут в stderr,
 * DEBUG/INFO — в stdout. `silent` глушит всё. `configureMainLogger`
 * выбирает уровень от `isProduction` (prod = silent, dev = debug)
 * с возможностью перебить через `SKYFORK_LOG_LEVEL`.
 *
 * Эти тесты прямо отражают запрос «логи только для dev режима»: prod
 * по умолчанию должен молчать.
 */

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/skyfork-logger-test' },
}));

describe('Logger', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    delete process.env.SKYFORK_LOG_LEVEL;
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('default level is debug — все методы пишут', async () => {
    const { Logger } = await import('../../src/core/utils/Logger');
    const l = new Logger('T');
    l.debug('d'); l.info('i'); l.log('lg'); l.warn('w'); l.error('e');
    expect(logSpy).toHaveBeenCalledTimes(3); // debug + info + log(=info)
    expect(errSpy).toHaveBeenCalledTimes(2); // warn + error
  });

  it('silent level — ничего не пишет', async () => {
    const { Logger } = await import('../../src/core/utils/Logger');
    const l = new Logger('T');
    l.setLevel('silent');
    l.debug('d'); l.info('i'); l.warn('w'); l.error('e');
    expect(logSpy).not.toHaveBeenCalled();
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('error level — только error пишется', async () => {
    const { Logger } = await import('../../src/core/utils/Logger');
    const l = new Logger('T');
    l.setLevel('error');
    l.debug('d'); l.info('i'); l.warn('w'); l.error('e');
    expect(logSpy).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalledTimes(1);
  });

  it('warn level — warn + error', async () => {
    const { Logger } = await import('../../src/core/utils/Logger');
    const l = new Logger('T');
    l.setLevel('warn');
    l.debug('d'); l.info('i'); l.warn('w'); l.error('e');
    expect(logSpy).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalledTimes(2);
  });

  it('info level — info/log + warn + error, debug режется', async () => {
    const { Logger } = await import('../../src/core/utils/Logger');
    const l = new Logger('T');
    l.setLevel('info');
    l.debug('d'); l.info('i'); l.log('lg'); l.warn('w'); l.error('e');
    // info + log → 2 на stdout
    expect(logSpy).toHaveBeenCalledTimes(2);
    // warn + error → 2 на stderr
    expect(errSpy).toHaveBeenCalledTimes(2);
  });

  it('тэг и время префиксуют сообщение', async () => {
    const { Logger } = await import('../../src/core/utils/Logger');
    const l = new Logger('GitTest');
    l.warn('something');
    const line = errSpy.mock.calls[0]?.[0] as string;
    expect(line).toMatch(/^\[GitTest\] \d{2}:\d{2}:\d{2} WARN: something$/);
  });

  it('ERROR/WARN идут в stderr, DEBUG/INFO — в stdout', async () => {
    const { Logger } = await import('../../src/core/utils/Logger');
    const l = new Logger('T');
    l.debug('d');
    l.info('i');
    l.warn('w');
    l.error('e');
    expect(logSpy).toHaveBeenCalledTimes(2);
    expect(errSpy).toHaveBeenCalledTimes(2);
  });

  it('dispose закрывает file stream без ошибки', async () => {
    const { Logger } = await import('../../src/core/utils/Logger');
    const l = new Logger('T');
    expect(() => l.dispose()).not.toThrow();
  });

  describe('configureMainLogger', () => {
    it('prod (isProduction=true) → silent', async () => {
      const mod = await import('../../src/core/utils/Logger');
      mod.configureMainLogger({ isProduction: true });
      expect(mod.mainLogger.getLevel()).toBe('silent');
      mod.mainLogger.debug('d'); mod.mainLogger.error('e');
      expect(logSpy).not.toHaveBeenCalled();
      expect(errSpy).not.toHaveBeenCalled();
    });

    it('dev (isProduction=false) → debug', async () => {
      const mod = await import('../../src/core/utils/Logger');
      mod.configureMainLogger({ isProduction: false });
      expect(mod.mainLogger.getLevel()).toBe('debug');
      mod.mainLogger.debug('d');
      expect(logSpy).toHaveBeenCalled();
    });

    it('SKYFORK_LOG_LEVEL=warn перебивает дефолт даже в dev', async () => {
      process.env.SKYFORK_LOG_LEVEL = 'warn';
      const mod = await import('../../src/core/utils/Logger');
      mod.configureMainLogger({ isProduction: false });
      expect(mod.mainLogger.getLevel()).toBe('warn');
      mod.mainLogger.debug('d'); // отбросится
      mod.mainLogger.warn('w');
      expect(logSpy).not.toHaveBeenCalled();
      expect(errSpy).toHaveBeenCalledTimes(1);
    });

    it('SKYFORK_LOG_LEVEL=debug включает логи в prod (для дебага у юзера)', async () => {
      process.env.SKYFORK_LOG_LEVEL = 'debug';
      const mod = await import('../../src/core/utils/Logger');
      mod.configureMainLogger({ isProduction: true });
      expect(mod.mainLogger.getLevel()).toBe('debug');
    });

    it('невалидный SKYFORK_LOG_LEVEL — игнор, дефолт по isProduction', async () => {
      process.env.SKYFORK_LOG_LEVEL = 'verbose';
      const mod = await import('../../src/core/utils/Logger');
      mod.configureMainLogger({ isProduction: true });
      expect(mod.mainLogger.getLevel()).toBe('silent');
    });
  });
});
