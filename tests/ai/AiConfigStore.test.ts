import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { AiConfigStore, type CryptoProvider } from '../../src/core/ai/AiConfigStore';

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
  dir = mkdtempSync(join(tmpdir(), 'skyfork-ai-'));
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
    require('fs').writeFileSync(
      join(dir, 'ai-config.json'),
      JSON.stringify({ version: 1, baseUrl: 'http://x/v1', apiKeyEncrypted: 'plain:legacy', model: 'm' }),
      'utf-8',
    );
    const store = new AiConfigStore(dir, makeCrypto(true));
    expect(store.load()?.apiKey).toBe('legacy');
  });

  it('returns empty apiKey when encrypted blob undecodable', () => {
    require('fs').writeFileSync(
      join(dir, 'ai-config.json'),
      JSON.stringify({ version: 1, baseUrl: 'http://x/v1', apiKeyEncrypted: 'enc:garbage', model: 'm' }),
      'utf-8',
    );
    const store = new AiConfigStore(dir, makeCrypto(true));
    expect(store.load()?.apiKey).toBe('');
  });
});
