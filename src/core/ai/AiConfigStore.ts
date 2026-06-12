import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { atomicWriteJSON } from '../safety/AtomicWrite';
import type {
  AiConnectionMode,
  AiFeatureId,
  AiProviderConfig,
  AiResponseLanguage,
  CommitLanguage,
  PromptId,
} from './types';

/**
 * Шифровальщик. В main-процессе сюда передаём Electron `safeStorage` (AES
 * через DPAPI на Windows / Keychain на macOS / libsecret на Linux). В
 * тестах — ручной мок. Без шифрования ключ хранится плейнтекстом с
 * префиксом `plain:`, чтобы его было видно при диагностике.
 */
export interface CryptoProvider {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

const FILE_NAME = 'ai-config.json';
const FORMAT_VERSION = 3;

interface PersistedConfig {
  version: number;
  mode?: AiConnectionMode;
  baseUrl: string;
  apiKeyEncrypted: string;
  qwenWebTokenEncrypted?: string;
  qwenWebCookieEncrypted?: string;
  model: string;
  /** v2-only: оставлено для миграции, в v3 не пишется. */
  commitLanguage?: CommitLanguage;
  headers?: Record<string, string>;
  timeoutMs?: number;
  systemInUser?: boolean;
  qwenDisableThinking?: boolean;
  stripThinkTags?: boolean;
  extraBody?: Record<string, unknown>;
  debugLogging?: boolean;
  /** v3 fields. */
  aiResponseLanguage?: AiResponseLanguage;
  prompts?: Partial<Record<PromptId, string>>;
  features?: Partial<Record<AiFeatureId, boolean>>;
  modelOverrides?: Partial<Record<AiFeatureId, string>>;
  aiEnabled?: boolean;
  allowCloudCodeShare?: boolean;
}

/**
 * Дефолты для свежего/мигрированного конфига. Импортозамещающая логика:
 * - все фичи cloud-провайдеров блокируются `allowCloudCodeShare=false`
 *   (юзер явно разрешает отправку кода зарубеж);
 * - `aiEnabled=true` чтобы первая установка работала из коробки;
 * - `features.commitMessage=true` — единственная Tier-1 фича.
 */
const V3_DEFAULTS = {
  features: { commitMessage: true } as Partial<Record<AiFeatureId, boolean>>,
  modelOverrides: {} as Partial<Record<AiFeatureId, string>>,
  aiEnabled: true,
  allowCloudCodeShare: false,
} as const;

/**
 * Хранит AI-конфиг в `{userData}/ai-config.json`. Запись — через atomic
 * rename, чтобы не получить битый json при падении процесса. API-ключ
 * шифруется системным key store (safeStorage), fallback — плейнтекст.
 */
export class AiConfigStore {
  private readonly filePath: string;

  constructor(
    userDataDir: string,
    private readonly crypto: CryptoProvider,
  ) {
    this.filePath = join(userDataDir, FILE_NAME);
  }

  load(): AiProviderConfig | null {
    if (!existsSync(this.filePath)) return null;
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(this.filePath, 'utf-8'));
    } catch {
      return null;
    }
    if (!raw || typeof raw !== 'object') return null;
    const p = migrateToV3(raw as Partial<PersistedConfig>);

    const mode: AiConnectionMode =
      p.mode === 'qwen-web' ? 'qwen-web' : 'openai-compatible';

    const sharedV3 = {
      aiResponseLanguage: normalizeResponseLanguage(p.aiResponseLanguage),
      prompts: sanitizePrompts(p.prompts),
      features: sanitizeFeatures(p.features),
      modelOverrides: sanitizeModelOverrides(p.modelOverrides),
      aiEnabled: p.aiEnabled !== false,
      allowCloudCodeShare: p.allowCloudCodeShare === true,
    } as const;

    if (mode === 'qwen-web') return null;

    if (!p.baseUrl || !p.model) return null;
    return {
      mode: 'openai-compatible',
      baseUrl: p.baseUrl,
      apiKey: this.decode(p.apiKeyEncrypted ?? ''),
      model: p.model,
      commitLanguage: normalizeLanguage(p.commitLanguage),
      headers: p.headers,
      timeoutMs: p.timeoutMs,
      systemInUser: p.systemInUser,
      qwenDisableThinking: p.qwenDisableThinking,
      stripThinkTags: p.stripThinkTags,
      extraBody: p.extraBody,
      debugLogging: p.debugLogging,
      ...sharedV3,
    };
  }

  async save(cfg: AiProviderConfig): Promise<void> {
    const mode = cfg.mode ?? 'openai-compatible';
    const v3Common = {
      aiResponseLanguage: normalizeResponseLanguage(cfg.aiResponseLanguage),
      prompts: sanitizePrompts(cfg.prompts),
      features: sanitizeFeatures(cfg.features),
      modelOverrides: sanitizeModelOverrides(cfg.modelOverrides),
      aiEnabled: cfg.aiEnabled !== false,
      allowCloudCodeShare: cfg.allowCloudCodeShare === true,
    } as const;
    if (mode === 'qwen-web') {
      const persisted: PersistedConfig = {
        version: FORMAT_VERSION,
        mode: 'qwen-web',
        baseUrl: '',
        apiKeyEncrypted: '',
        qwenWebTokenEncrypted: this.encode(cfg.qwenWebToken || ''),
        qwenWebCookieEncrypted: this.encode(cfg.qwenWebCookie || ''),
        model: cfg.model,
        timeoutMs: cfg.timeoutMs,
        ...v3Common,
      };
      await atomicWriteJSON(this.filePath, persisted);
      return;
    }

    const persisted: PersistedConfig = {
      version: FORMAT_VERSION,
      mode: 'openai-compatible',
      baseUrl: cfg.baseUrl,
      apiKeyEncrypted: this.encode(cfg.apiKey || ''),
      qwenWebTokenEncrypted: '',
      qwenWebCookieEncrypted: '',
      model: cfg.model,
      headers: cfg.headers,
      timeoutMs: cfg.timeoutMs,
      systemInUser: cfg.systemInUser,
      qwenDisableThinking: cfg.qwenDisableThinking,
      stripThinkTags: cfg.stripThinkTags,
      extraBody: cfg.extraBody,
      debugLogging: cfg.debugLogging,
      ...v3Common,
    };
    await atomicWriteJSON(this.filePath, persisted);
  }

  /** Сбрасываем в «пустую» запись, а не удаляем файл — проще диагностировать. */
  async clear(): Promise<void> {
    const empty: PersistedConfig = {
      version: FORMAT_VERSION,
      mode: 'openai-compatible',
      baseUrl: '',
      apiKeyEncrypted: '',
      qwenWebTokenEncrypted: '',
      qwenWebCookieEncrypted: '',
      model: '',
      ...V3_DEFAULTS,
    };
    await atomicWriteJSON(this.filePath, empty);
  }

  private encode(plain: string): string {
    if (!plain) return '';
    if (this.crypto.isEncryptionAvailable()) {
      try {
        const buf = this.crypto.encryptString(plain);
        return `enc:${buf.toString('base64')}`;
      } catch {
        // safeStorage может упасть если key store недоступен — fallback ниже
      }
    }
    return `plain:${plain}`;
  }

  private decode(stored: string): string {
    if (!stored) return '';
    if (stored.startsWith('enc:')) {
      try {
        return this.crypto.decryptString(Buffer.from(stored.slice(4), 'base64'));
      } catch {
        return '';
      }
    }
    if (stored.startsWith('plain:')) return stored.slice(6);
    return stored;
  }
}

function normalizeLanguage(value: unknown): CommitLanguage {
  if (value === 'en' || value === 'ru') return value;
  return 'auto';
}

function normalizeResponseLanguage(value: unknown): AiResponseLanguage {
  if (value === 'en' || value === 'ru') return value;
  return 'auto';
}

/**
 * Миграция персистированного конфига v1/v2 в v3.
 *
 * v1: без `version` или `version=1`. Уже валидный shape ai-config.json,
 *     просто без `mode` (только `openai-compatible`).
 * v2: добавлен `mode`, `commitLanguage`. Поля v3 (`prompts`, `features`,
 *     `modelOverrides`, `aiEnabled`, `allowCloudCodeShare`,
 *     `aiResponseLanguage`) отсутствуют.
 *
 * v2 → v3:
 *   - features.commitMessage = true (единственная Tier-1 фича на момент v3).
 *   - modelOverrides = {} (по умолчанию основная модель для всех фич).
 *   - aiEnabled = true (старый конфиг работал, не ломаем UX).
 *   - allowCloudCodeShare = false (для импортозамещения: даже если у
 *     юзера был cloud-провайдер, мы по умолчанию НЕ продолжаем тихо
 *     слать туда код — пусть включит явно).
 *   - aiResponseLanguage = старый commitLanguage (auto/en/ru).
 *
 * v3-конфиг возвращается без изменений (поля проверит вызывающий
 * через `sanitize*`).
 */
export function migrateToV3(p: Partial<PersistedConfig>): Partial<PersistedConfig> {
  if (p.version === FORMAT_VERSION) return p;
  // v2 (или раньше) → v3
  const v2Lang: AiResponseLanguage = (() => {
    if (p.commitLanguage === 'en' || p.commitLanguage === 'ru') return p.commitLanguage;
    return 'auto';
  })();
  return {
    ...p,
    version: FORMAT_VERSION,
    features: V3_DEFAULTS.features,
    modelOverrides: V3_DEFAULTS.modelOverrides,
    aiEnabled: V3_DEFAULTS.aiEnabled,
    allowCloudCodeShare: V3_DEFAULTS.allowCloudCodeShare,
    aiResponseLanguage: v2Lang,
  };
}

function sanitizePrompts(raw: unknown): Partial<Record<PromptId, string>> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const allowed: PromptId[] = ['commitMessage', 'explainCommit', 'stashName', 'explainReflog', 'analyzeConflict'];
  const out: Partial<Record<PromptId, string>> = {};
  let hasAny = false;
  for (const k of allowed) {
    const v = (raw as Record<string, unknown>)[k];
    if (typeof v === 'string' && v.length > 0) {
      out[k] = v;
      hasAny = true;
    }
  }
  return hasAny ? out : undefined;
}

function sanitizeFeatures(raw: unknown): Partial<Record<AiFeatureId, boolean>> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const allowed: AiFeatureId[] = ['commitMessage', 'explainCommit', 'stashName', 'explainReflog', 'analyzeConflict', 'semanticSearch'];
  const out: Partial<Record<AiFeatureId, boolean>> = {};
  let hasAny = false;
  for (const k of allowed) {
    const v = (raw as Record<string, unknown>)[k];
    if (typeof v === 'boolean') {
      out[k] = v;
      hasAny = true;
    }
  }
  return hasAny ? out : undefined;
}

function sanitizeModelOverrides(raw: unknown): Partial<Record<AiFeatureId, string>> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const allowed: AiFeatureId[] = ['commitMessage', 'explainCommit', 'stashName', 'explainReflog', 'analyzeConflict', 'semanticSearch'];
  const out: Partial<Record<AiFeatureId, string>> = {};
  let hasAny = false;
  for (const k of allowed) {
    const v = (raw as Record<string, unknown>)[k];
    if (typeof v === 'string' && v.trim().length > 0) {
      out[k] = v;
      hasAny = true;
    }
  }
  return hasAny ? out : undefined;
}
