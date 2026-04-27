import type { AiService } from './AiService';
import type { AiConfigStore } from './AiConfigStore';
import { AiError, type AiProviderConfig } from './types';

export interface AiTestResult {
  success: boolean;
  error?: string;
}

/**
 * Бизнес-логика AI-команд. Держится отдельно от MessageBridge, чтобы
 * (а) не раздувать и без того большой bridge-файл, (б) иметь чистую
 * поверхность для юнит-тестов без Electron/IPC.
 *
 * Управляет жизненным циклом генерации по `requestId`: одновременно
 * может быть несколько генераций (например пользователь открыл 2 репо),
 * но обычно одна. `cancel` гарантированно останавливает конкретный запрос.
 */
export class AiHandlers {
  private readonly pending = new Map<string, AbortController>();

  constructor(
    private readonly service: AiService,
    private readonly store: AiConfigStore,
  ) {}

  /** Текущий конфиг, без секрета (apiKey маскируется). Для UI. */
  getConfig(): AiProviderConfig | null {
    const cfg = this.service.getConfig();
    if (!cfg) return null;
    return { ...cfg, apiKey: cfg.apiKey ? '••••••••' : '' };
  }

  /** Новая конфигурация. Null — очистка. Сохраняем на диск + в in-memory service. */
  async setConfig(cfg: AiProviderConfig | null): Promise<void> {
    if (cfg === null) {
      this.service.setConfig(null);
      await this.store.clear();
      return;
    }
    // Пустой apiKey в DTO из UI означает «оставить как было» (мы его
    // маскируем в getConfig и не присылаем обратно в открытом виде).
    const merged = this.mergeApiKey(cfg);
    this.service.setConfig(merged);
    await this.store.save(merged);
  }

  async testConnection(cfg: AiProviderConfig): Promise<AiTestResult> {
    try {
      const merged = this.mergeApiKey(cfg);
      const tempService = new (this.service.constructor as typeof AiService)(merged);
      await tempService.testConnection();
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async generateCommitMessage(
    requestId: string,
    diff: string,
    onChunk: (delta: string) => void,
  ): Promise<{ text: string; finishReason: string }> {
    if (!this.service.isConfigured()) {
      throw new AiError('AI provider is not configured', 'config');
    }
    const controller = new AbortController();
    this.pending.set(requestId, controller);
    try {
      const res = await this.service.generateCommitMessage({
        diff,
        signal: controller.signal,
        onChunk,
      });
      if (!res.text.trim()) {
        if (res.finishReason === 'length') {
          throw new AiError(
            'Model stopped on max_tokens before producing text. Context may be too large or server cut the output.',
            'parse',
          );
        }
        throw new AiError('Model returned empty response', 'parse');
      }
      return { text: res.text, finishReason: res.finishReason };
    } finally {
      this.pending.delete(requestId);
    }
  }

  cancel(requestId: string): void {
    const ctrl = this.pending.get(requestId);
    if (!ctrl) return;
    ctrl.abort();
    this.pending.delete(requestId);
  }

  cancelAll(): void {
    for (const ctrl of this.pending.values()) ctrl.abort();
    this.pending.clear();
  }

  /**
   * Если UI прислал пустой/маскированный apiKey — значит «оставить как был».
   * Это защищает от случайной очистки ключа при редактировании других полей.
   */
  private mergeApiKey(cfg: AiProviderConfig): AiProviderConfig {
    const isMasked = !cfg.apiKey || /^•+$/.test(cfg.apiKey);
    if (!isMasked) return cfg;
    const existing = this.service.getConfig();
    return { ...cfg, apiKey: existing?.apiKey ?? '' };
  }
}
