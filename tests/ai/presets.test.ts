import { describe, it, expect } from 'vitest';
import {
  detectPreset,
  AI_PRESETS,
  DEFAULT_PRESET_ID,
  isForeignPreset,
  isForeignByConnection,
  getPresetsByGroup,
} from '../../src/renderer/src/features/ai/presets';

describe('detectPreset', () => {
  describe('openai-compatible mode', () => {
    it('matches OpenAI baseUrl exactly', () => {
      expect(detectPreset('openai-compatible', 'https://api.openai.com/v1', 'gpt-4o-mini')).toBe('openai');
    });

    it('matches Ollama localhost baseUrl', () => {
      expect(detectPreset('openai-compatible', 'http://localhost:11434/v1', 'llama3.1:8b')).toBe('ollama');
    });

    it('matches LM Studio localhost baseUrl', () => {
      expect(detectPreset('openai-compatible', 'http://localhost:1234/v1', 'local-model')).toBe('lmstudio');
    });

    it('matches DeepSeek baseUrl', () => {
      expect(detectPreset('openai-compatible', 'https://api.deepseek.com/v1', 'deepseek-chat')).toBe('deepseek');
    });

    it('matches Groq baseUrl', () => {
      expect(detectPreset('openai-compatible', 'https://api.groq.com/openai/v1', 'llama-3.1-8b-instant')).toBe('groq');
    });

    it('returns custom for unknown baseUrl', () => {
      expect(detectPreset('openai-compatible', 'https://my.gateway.example.com/v1', 'whatever')).toBe('custom');
    });

    it('normalizes single trailing slash and matches', () => {
      expect(detectPreset('openai-compatible', 'https://api.openai.com/v1/', 'gpt-4o-mini')).toBe('openai');
    });

    it('normalizes multiple trailing slashes and matches', () => {
      expect(detectPreset('openai-compatible', 'https://api.openai.com/v1///', 'gpt-4o-mini')).toBe('openai');
    });

    it('normalizes leading/trailing whitespace and matches', () => {
      expect(detectPreset('openai-compatible', '   https://api.openai.com/v1   ', 'gpt-4o-mini')).toBe('openai');
    });

    it('does not confuse model when baseUrl matches (model is irrelevant for openai-compatible)', () => {
      expect(detectPreset('openai-compatible', 'https://api.openai.com/v1', 'totally-different-model')).toBe('openai');
    });

    it('returns custom for empty baseUrl', () => {
      expect(detectPreset('openai-compatible', '', 'gpt-4o-mini')).toBe('custom');
    });
  });

  describe('qwen-web mode', () => {
    it('matches qwen-web preset when model is qwen3-max', () => {
      expect(detectPreset('qwen-web', '', 'qwen3-max')).toBe('qwen-web');
    });

    it('returns custom for qwen-web with non-default model', () => {
      expect(detectPreset('qwen-web', '', 'qwen3-coder-plus')).toBe('custom');
    });

    it('ignores baseUrl for qwen-web detection', () => {
      expect(detectPreset('qwen-web', 'https://example.com/v1', 'qwen3-max')).toBe('qwen-web');
    });

    it('handles whitespace around model id', () => {
      expect(detectPreset('qwen-web', '', '  qwen3-max  ')).toBe('qwen-web');
    });
  });
});

describe('AI_PRESETS sanity', () => {
  it('has unique ids', () => {
    const ids = AI_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('exposes the qwen-web preset', () => {
    const qwen = AI_PRESETS.find((p) => p.mode === 'qwen-web');
    expect(qwen).toBeDefined();
    expect(qwen?.id).toBe('qwen-web');
  });

  it('all openai-compatible presets have non-empty baseUrl, except corporate ones (user fills baseUrl)', () => {
    const corporateIds = new Set(['qwen-corporate', 'custom-corporate']);
    for (const p of AI_PRESETS) {
      if (p.mode === 'openai-compatible' && !corporateIds.has(p.id)) {
        expect(p.baseUrl.length).toBeGreaterThan(0);
      }
    }
  });

  it('default preset is the first local one (Ollama)', () => {
    expect(DEFAULT_PRESET_ID).toBe('ollama');
    const def = AI_PRESETS.find((p) => p.id === DEFAULT_PRESET_ID);
    expect(def?.group).toBe('local');
  });

  it('groups are populated in the expected priority order', () => {
    const g = getPresetsByGroup();
    expect(g.local.length).toBeGreaterThan(0);
    expect(g.corporate.length).toBeGreaterThan(0);
    expect(g['no-vpn'].length).toBeGreaterThan(0);
    expect(g.russian.length).toBeGreaterThan(0); // YandexGPT mandatory in MVP
    expect(g.foreign.length).toBeGreaterThan(0);
  });

  it('YandexGPT preset is registered as russian', () => {
    const y = AI_PRESETS.find((p) => p.id === 'yandexgpt');
    expect(y?.group).toBe('russian');
    expect(y?.baseUrl).toMatch(/yandex/);
  });
});

describe('isForeignPreset / isForeignByConnection', () => {
  it('flags OpenAI / Anthropic / Groq as foreign', () => {
    expect(isForeignPreset('openai')).toBe(true);
    expect(isForeignPreset('anthropic')).toBe(true);
    expect(isForeignPreset('groq')).toBe(true);
  });

  it('does NOT flag locals/corporate/no-vpn/russian as foreign', () => {
    expect(isForeignPreset('ollama')).toBe(false);
    expect(isForeignPreset('lmstudio')).toBe(false);
    expect(isForeignPreset('qwen-corporate')).toBe(false);
    expect(isForeignPreset('qwen-web')).toBe(false);
    expect(isForeignPreset('qwen-api')).toBe(false);
    expect(isForeignPreset('deepseek')).toBe(false);
    expect(isForeignPreset('yandexgpt')).toBe(false);
  });

  it('unknown preset id is not foreign', () => {
    expect(isForeignPreset('whatever')).toBe(false);
  });

  it('isForeignByConnection detects custom OpenAI baseUrl', () => {
    expect(isForeignByConnection('openai-compatible', 'https://api.openai.com/v1')).toBe(true);
    expect(isForeignByConnection('openai-compatible', 'https://api.anthropic.com/v1')).toBe(true);
  });

  it('isForeignByConnection ignores qwen-web mode', () => {
    expect(isForeignByConnection('qwen-web', 'whatever')).toBe(false);
  });

  it('isForeignByConnection returns false for unknown host', () => {
    expect(isForeignByConnection('openai-compatible', 'https://internal.acme.corp/v1')).toBe(false);
  });
});
