import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { atomicWriteJSON } from '../safety/AtomicWrite';
import type { AiConnectionMode, AiProviderConfig, CommitLanguage } from './types';

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
const FORMAT_VERSION = 2;

interface PersistedConfig {
  version: number;
  mode?: AiConnectionMode;
  baseUrl: string;
  apiKeyEncrypted: string;
  qwenWebTokenEncrypted?: string;
  model: string;
  commitLanguage?: CommitLanguage;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

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
    const p = raw as Partial<PersistedConfig>;

    const mode: AiConnectionMode =
      p.mode === 'qwen-web' ? 'qwen-web' : 'openai-compatible';

    if (mode === 'qwen-web') {
      if (!p.model) return null;
      const token = this.decode(p.qwenWebTokenEncrypted ?? '');
      if (!token) return null;
      return {
        mode: 'qwen-web',
        baseUrl: 'https://chat.qwen.ai',
        apiKey: '',
        qwenWebToken: token,
        model: p.model,
        commitLanguage: normalizeLanguage(p.commitLanguage),
        timeoutMs: p.timeoutMs,
      };
    }

    if (!p.baseUrl || !p.model) return null;
    return {
      mode: 'openai-compatible',
      baseUrl: p.baseUrl,
      apiKey: this.decode(p.apiKeyEncrypted ?? ''),
      model: p.model,
      commitLanguage: normalizeLanguage(p.commitLanguage),
      headers: p.headers,
      timeoutMs: p.timeoutMs,
    };
  }

  async save(cfg: AiProviderConfig): Promise<void> {
    const mode = cfg.mode ?? 'openai-compatible';
    if (mode === 'qwen-web') {
      const persisted: PersistedConfig = {
        version: FORMAT_VERSION,
        mode: 'qwen-web',
        baseUrl: '',
        apiKeyEncrypted: '',
        qwenWebTokenEncrypted: this.encode(cfg.qwenWebToken || ''),
        model: cfg.model,
        commitLanguage: normalizeLanguage(cfg.commitLanguage),
        timeoutMs: cfg.timeoutMs,
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
      model: cfg.model,
      commitLanguage: normalizeLanguage(cfg.commitLanguage),
      headers: cfg.headers,
      timeoutMs: cfg.timeoutMs,
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
      model: '',
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
