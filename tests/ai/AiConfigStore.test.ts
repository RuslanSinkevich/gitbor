import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { AiConfigStore, migrateToV3, type CryptoProvider } from '../../src/core/ai/AiConfigStore';

/**
 * v3-defaults, которые `load()` подмешивает в каждый возвращаемый
 * `AiProviderConfig`. Держим в одном месте, чтобы тесты не повторяли
 * один и тот же набор полей.
 */
const V3_LOADED_DEFAULTS = {
  aiResponseLanguage: 'auto',
  prompts: undefined,
  features: undefined,
  modelOverrides: undefined,
  aiEnabled: true,
  allowCloudCodeShare: false,
} as const;

function makeCrypto(available: boolean): CryptoProvider {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plain) => Buffer.from(`ENC(${plain})`, 'utf-8'),
    decryptString: (buf) => {
      const s = buf.toString('utf-8');
      const m = /^ENC\((.*)\)$/.exec(s);
      if (!m) throw new Error('decrypt failed');
      return m[1];
    },
  };
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gitbor-ai-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('AiConfigStore.load', () => {
  it('returns null when file does not exist', () => {
    const store = new AiConfigStore(dir, makeCrypto(true));
    expect(store.load()).toBeNull();
  });

  it('returns null on corrupt JSON', () => {
    const store = new AiConfigStore(dir, makeCrypto(true));
    require('fs').writeFileSync(join(dir, 'ai-config.json'), 'not json', 'utf-8');
    expect(store.load()).toBeNull();
  });
});

describe('AiConfigStore.save / load roundtrip', () => {
  it('persists and decrypts config when safeStorage available', async () => {
    const store = new AiConfigStore(dir, makeCrypto(true));
    await store.save({ baseUrl: 'http://x/v1', apiKey: 'sk-secret', model: 'gpt' });
    const raw = readFileSync(join(dir, 'ai-config.json'), 'utf-8');
    expect(raw).not.toContain('sk-secret');
    expect(raw).toContain('enc:');
    const loaded = store.load();
    expect(loaded).toEqual({
      mode: 'openai-compatible',
      baseUrl: 'http://x/v1',
      apiKey: 'sk-secret',
      model: 'gpt',
      commitLanguage: 'auto',
      headers: undefined,
      timeoutMs: undefined,
      ...V3_LOADED_DEFAULTS,
    });
  });

  it('falls back to plain when safeStorage unavailable', async () => {
    const store = new AiConfigStore(dir, makeCrypto(false));
    await store.save({ baseUrl: 'http://x/v1', apiKey: 'sk-plain', model: 'gpt' });
    const raw = readFileSync(join(dir, 'ai-config.json'), 'utf-8');
    expect(raw).toContain('plain:sk-plain');
    const loaded = store.load();
    expect(loaded?.apiKey).toBe('sk-plain');
  });

  it('persists empty apiKey as empty string (local Ollama case)', async () => {
    const store = new AiConfigStore(dir, makeCrypto(true));
    await store.save({ baseUrl: 'http://localhost:11434/v1', apiKey: '', model: 'llama3' });
    const loaded = store.load();
    expect(loaded?.apiKey).toBe('');
  });

  it('preserves headers and timeoutMs', async () => {
    const store = new AiConfigStore(dir, makeCrypto(true));
    await store.save({
      baseUrl: 'http://x/v1',
      apiKey: 'k',
      model: 'm',
      headers: { 'x-org': 'acme' },
      timeoutMs: 120_000,
    });
    const loaded = store.load();
    expect(loaded?.headers).toEqual({ 'x-org': 'acme' });
    expect(loaded?.timeoutMs).toBe(120_000);
  });

  it('persists qwen-web token separately from apiKey', async () => {
    const store = new AiConfigStore(dir, makeCrypto(true));
    await store.save({
      mode: 'qwen-web',
      baseUrl: 'https://chat.qwen.ai',
      apiKey: '',
      qwenWebToken: 'web-tok',
      model: 'qwen3-max',
    });
    const raw = readFileSync(join(dir, 'ai-config.json'), 'utf-8');
    expect(raw).not.toContain('web-tok');
    const loaded = store.load();
    expect(loaded).toEqual({
      mode: 'qwen-web',
      baseUrl: 'https://chat.qwen.ai',
      apiKey: '',
      qwenWebToken: 'web-tok',
      model: 'qwen3-max',
      commitLanguage: 'auto',
      timeoutMs: undefined,
      ...V3_LOADED_DEFAULTS,
    });
  });

  it('uses atomic write (no .tmp-* files left on success)', async () => {
    const store = new AiConfigStore(dir, makeCrypto(true));
    await store.save({ baseUrl: 'http://x/v1', apiKey: 'k', model: 'm' });
    const files = require('fs').readdirSync(dir) as string[];
    expect(files.filter((f) => f.startsWith('.tmp-'))).toHaveLength(0);
    expect(files).toContain('ai-config.json');
  });
});

describe('AiConfigStore.clear', () => {
  it('writes empty config and load returns null (missing baseUrl)', async () => {
    const store = new AiConfigStore(dir, makeCrypto(true));
    await store.save({ baseUrl: 'http://x/v1', apiKey: 'k', model: 'm' });
    await store.clear();
    expect(existsSync(join(dir, 'ai-config.json'))).toBe(true);
    expect(store.load()).toBeNull();
  });
});

describe('AiConfigStore legacy formats', () => {
  it('accepts stored plain:-prefixed key', () => {
    writeFileSync(
      join(dir, 'ai-config.json'),
      JSON.stringify({ version: 1, baseUrl: 'http://x/v1', apiKeyEncrypted: 'plain:legacy', model: 'm' }),
      'utf-8',
    );
    const store = new AiConfigStore(dir, makeCrypto(true));
    expect(store.load()?.apiKey).toBe('legacy');
  });

  it('returns empty apiKey when encrypted blob undecodable', () => {
    writeFileSync(
      join(dir, 'ai-config.json'),
      JSON.stringify({ version: 1, baseUrl: 'http://x/v1', apiKeyEncrypted: 'enc:garbage', model: 'm' }),
      'utf-8',
    );
    const store = new AiConfigStore(dir, makeCrypto(true));
    expect(store.load()?.apiKey).toBe('');
  });
});

describe('migrateToV3', () => {
  it('promotes v2 ru commitLanguage to aiResponseLanguage=ru', () => {
    const migrated = migrateToV3({
      version: 2,
      mode: 'openai-compatible',
      baseUrl: 'http://x',
      apiKeyEncrypted: '',
      model: 'm',
      commitLanguage: 'ru',
    });
    expect(migrated.version).toBe(3);
    expect(migrated.aiResponseLanguage).toBe('ru');
  });

  it('promotes v2 en commitLanguage to aiResponseLanguage=en', () => {
    const migrated = migrateToV3({
      version: 2,
      mode: 'openai-compatible',
      baseUrl: 'http://x',
      apiKeyEncrypted: '',
      model: 'm',
      commitLanguage: 'en',
    });
    expect(migrated.aiResponseLanguage).toBe('en');
  });

  it('defaults missing commitLanguage to aiResponseLanguage=auto', () => {
    const migrated = migrateToV3({ version: 2, baseUrl: 'http://x', apiKeyEncrypted: '', model: 'm' });
    expect(migrated.aiResponseLanguage).toBe('auto');
  });

  it('forces allowCloudCodeShare=false on v2 -> v3 (no implicit cloud opt-in)', () => {
    const migrated = migrateToV3({ version: 2, baseUrl: 'http://x', apiKeyEncrypted: '', model: 'm' });
    expect(migrated.allowCloudCodeShare).toBe(false);
  });

  it('enables only commitMessage by default on v2 -> v3', () => {
    const migrated = migrateToV3({ version: 2, baseUrl: 'http://x', apiKeyEncrypted: '', model: 'm' });
    expect(migrated.features).toEqual({ commitMessage: true });
    expect(migrated.modelOverrides).toEqual({});
    expect(migrated.aiEnabled).toBe(true);
  });

  it('leaves v3 config untouched', () => {
    const v3 = {
      version: 3,
      baseUrl: 'http://x',
      apiKeyEncrypted: '',
      model: 'm',
      aiResponseLanguage: 'en' as const,
      allowCloudCodeShare: true,
      features: { commitMessage: false, explainCommit: true },
    };
    expect(migrateToV3(v3)).toBe(v3);
  });
});

describe('AiConfigStore v2 -> v3 load migration', () => {
  it('reads ru commitLanguage from v2 file as aiResponseLanguage=ru', () => {
    writeFileSync(
      join(dir, 'ai-config.json'),
      JSON.stringify({
        version: 2,
        mode: 'openai-compatible',
        baseUrl: 'http://x/v1',
        apiKeyEncrypted: 'plain:k',
        model: 'gpt',
        commitLanguage: 'ru',
      }),
      'utf-8',
    );
    const store = new AiConfigStore(dir, makeCrypto(true));
    const loaded = store.load();
    expect(loaded?.aiResponseLanguage).toBe('ru');
    expect(loaded?.allowCloudCodeShare).toBe(false);
    expect(loaded?.aiEnabled).toBe(true);
  });
});
