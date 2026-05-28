import type { AiService } from './AiService';
import type { AiConfigStore } from './AiConfigStore';
import type { AiDebugStore } from './AiDebugStore';
import { AiError, type AiConnectionMode, type AiDebugSnapshot, type AiProviderConfig } from './types';

/**
 * Хосты «зарубежных» облачных провайдеров. `allowCloudCodeShare=false`
 * блокирует отправку diff/кода на эти хосты — но НЕ на локальные
 * (localhost/127.0.0.1/0.0.0.0), не на российские (yandex), не на
 * без-VPN (Qwen/DashScope/DeepSeek), не на корпоративные gateway'и.
 *
 * Дублируется в renderer (presets.ts/isForeignByConnection) — там
 * нужен синхронный UI-gate; здесь — финальная проверка в main.
 */
const FOREIGN_HOSTS = new Set<string>([
  'api.openai.com',
  'api.anthropic.com',
  'api.groq.com',
]);

function isForeignBaseUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return FOREIGN_HOSTS.has(new URL(url).host.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Проверить, можно ли выполнить AI-вызов с текущим конфигом. Бросает
 * `AiError('config')` если:
 *   - `aiEnabled=false` (kill-switch),
 *   - провайдер зарубежный, а `allowCloudCodeShare=false`.
 *
 * Локальные / корпоративные / российские / без-VPN провайдеры НЕ
 * блокируются — это сознательное решение (см. ADR в
 * `docs/tasks/ai-settings-redesign-todo.md`).
 */
export function ensureFeatureAllowed(cfg: AiProviderConfig | null): void {
  if (!cfg) throw new AiError('AI provider is not configured', 'config');
  if (cfg.aiEnabled === false) {
    throw new AiError('AI is disabled in settings (Privacy → AI enabled).', 'config');
  }
  const mode: AiConnectionMode = cfg.mode ?? 'openai-compatible';
  if (mode === 'qwen-web') return;
  if (!isForeignBaseUrl(cfg.baseUrl)) return;
  if (cfg.allowCloudCodeShare === true) return;
  throw new AiError(
    'This provider is a foreign cloud (OpenAI/Anthropic/Groq). Enable "Allow sending code to foreign providers" in AI Settings → Privacy or pick a local / Russian provider.',
    'config',
  );
}

interface AiTestResult {
  success: boolean;
  error?: string;
}

const TEST_PROMPT_DIFF = `diff --git a/sample.ts b/sample.ts
@@ -1,2 +1,3 @@
 export const greet = () => 'hi';
+export const farewell = () => 'bye';
`;

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
    private readonly debug?: AiDebugStore,
  ) {}

  /** Текущий конфиг, без секрета (apiKey / qwenWebToken маскируются). Для UI. */
  getConfig(): AiProviderConfig | null {
    const cfg = this.service.getConfig();
    if (!cfg) return null;
    const mode: AiConnectionMode = cfg.mode ?? 'openai-compatible';
    if (mode === 'qwen-web') {
      return {
        ...cfg,
        baseUrl: cfg.baseUrl || 'https://chat.qwen.ai',
        apiKey: '',
        qwenWebToken: cfg.qwenWebToken ? '••••••••' : '',
      };
    }
    return {
      ...cfg,
      apiKey: cfg.apiKey ? '••••••••' : '',
      qwenWebToken: '',
    };
  }

  /** Новая конфигурация. Null — очистка. Сохраняем на диск + в in-memory service. */
  async setConfig(cfg: AiProviderConfig | null): Promise<void> {
    if (cfg === null) {
      this.service.setConfig(null);
      await this.store.clear();
      return;
    }
    const merged = this.mergeSecrets(cfg);
    this.service.setConfig(merged);
    await this.store.save(merged);
  }

  async testConnection(cfg: AiProviderConfig): Promise<AiTestResult> {
    try {
      const merged = this.mergeSecrets(cfg);
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
    const cfg = this.service.getConfig();
    ensureFeatureAllowed(cfg);
    if (cfg?.features?.commitMessage === false) {
      throw new AiError('Commit message generation is disabled in AI Settings → Features.', 'config');
    }
    const controller = new AbortController();
    this.pending.set(requestId, controller);
    const debugEnabled = this.service.getConfig()?.debugLogging === true;
    try {
      const res = await this.service.generateCommitMessage({
        diff,
        signal: controller.signal,
        onChunk,
        debugSink: debugEnabled ? (s) => this.debug?.capture(s) : undefined,
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
   * Прогон dummy-diff'а через текущий конфиг с debug-перехватом. UI
   * получает снимок request/response для диагностики gateway'я.
   */
  async testPrompt(cfg: AiProviderConfig): Promise<{ success: boolean; error?: string; snapshot: AiDebugSnapshot | null }> {
    try {
      const merged = this.mergeSecrets(cfg);
      const tempService = new (this.service.constructor as typeof AiService)(merged);
      let snapshot: AiDebugSnapshot | null = null;
      const res = await tempService.generateCommitMessage({
        diff: TEST_PROMPT_DIFF,
        debugSink: (s) => { snapshot = s; this.debug?.capture(s); },
      });
      if (snapshot) (snapshot as AiDebugSnapshot).responseText = res.text;
      return { success: true, snapshot };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg, snapshot: this.debug?.getLast() ?? null };
    }
  }

  getLastDebug(): AiDebugSnapshot | null {
    return this.debug?.getLast() ?? null;
  }

  /**
   * Если UI прислал пустой/маскированный apiKey или qwenWebToken — «оставить как было».
   */
  private mergeSecrets(cfg: AiProviderConfig): AiProviderConfig {
    const mode: AiConnectionMode = cfg.mode ?? 'openai-compatible';
    if (mode === 'qwen-web') {
      const tok = cfg.qwenWebToken ?? '';
      const masked = !tok || /^•+$/.test(tok);
      if (!masked) return { ...cfg, mode: 'qwen-web' };
      const existing = this.service.getConfig();
      const prev =
        existing && (existing.mode ?? 'openai-compatible') === 'qwen-web'
          ? existing.qwenWebToken ?? ''
          : '';
      return { ...cfg, mode: 'qwen-web', qwenWebToken: prev };
    }

    const isMasked = !cfg.apiKey || /^•+$/.test(cfg.apiKey);
    if (!isMasked) return { ...cfg, mode: 'openai-compatible' };
    const existing = this.service.getConfig();
    return {
      ...cfg,
      mode: 'openai-compatible',
      apiKey: existing?.apiKey ?? '',
    };
  }
}
