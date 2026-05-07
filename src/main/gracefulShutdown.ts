/**
 * Graceful shutdown через `before-quit`: даём ~1.5с inflight write-операциям
 * (`git add`/`commit`) завершиться сами, чтобы они удалили `.git/index.lock`.
 * Без этого SIGTERM при выходе оставлял stale lock'и, и юзер видел recovery-
 * диалог «обнаружен .git/index.lock» при каждом следующем запуске.
 *
 * Реентрантная защита: после ожидания мы зовём `app.quit()`, что снова
 * триггерит `before-quit`. Внутренний флаг гарантирует, что второй заход
 * просто пропустится и окно реально закроется.
 *
 * Вынесено из main.ts отдельно для тестируемости — без этого пришлось бы
 * мокать целиком модуль electron.
 */

export interface GracefulShutdownEvent {
  preventDefault(): void;
}

export interface GracefulShutdownApp {
  on(event: 'before-quit', listener: (event: GracefulShutdownEvent) => void): unknown;
  quit(): void;
}

export interface GracefulShutdownRegistry {
  disposeAllGracefully(timeoutMs: number): Promise<void>;
}

/**
 * Установить обработчик `before-quit` с graceful-ожиданием inflight git-операций.
 * `getRegistry` — функция-геттер: на момент регистрации хендлера реестр в main
 * ещё может быть `null` (initServices ещё не закончил), поэтому проверяем lazy.
 */
export function setupGracefulShutdown(
  app: GracefulShutdownApp,
  getRegistry: () => GracefulShutdownRegistry | null,
  timeoutMs = 1500,
): void {
  let started = false;
  app.on('before-quit', (event) => {
    const registry = getRegistry();
    if (started || !registry) return;
    started = true;
    event.preventDefault();
    void (async () => {
      try {
        await registry.disposeAllGracefully(timeoutMs);
      } finally {
        app.quit();
      }
    })().catch(() => {
      // Ошибка disposeAllGracefully — некритично, мы всё равно вызвали app.quit
      // в finally. Глотаем здесь, чтобы не было unhandledRejection и чтобы
      // модуль был самодостаточен (раньше полагались на глобальный
      // process.on('unhandledRejection') в main.ts).
    });
  });
}
