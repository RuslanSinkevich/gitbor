import { describe, it, expect } from 'vitest';
import { detectPreset, AI_PRESETS } from '../../src/renderer/src/features/ai/presets';

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

  it('all openai-compatible presets have non-empty baseUrl, except qwen-corporate (user fills it)', () => {
    for (const p of AI_PRESETS) {
      if (p.mode === 'openai-compatible' && p.id !== 'qwen-corporate') {
        expect(p.baseUrl.length).toBeGreaterThan(0);
      }
    }
  });
});
