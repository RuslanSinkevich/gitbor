import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { computeAiOrigins } from '../../src/main/cspOrigins';
import { mainLogger } from '../../src/core/utils/Logger';
import type { AiProviderConfig } from '../../src/core/ai/types';

/**
 * Чистая функция `computeAiOrigins` маппит AiProviderConfig в список
 * origin'ов для CSP `connect-src`. Тестируем все ветки и edge-cases:
 * unconfigured, openai-compatible (https/http/trailing slash), qwen-web,
 * невалидные URL, пустой baseUrl. Ничего не должно throw'ать — функция
 * вызывается из webRequest hook на каждом response.
 */

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/skyfork-csp-test' },
}));

describe('computeAiOrigins', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Logger по умолчанию debug → warn'ы попадут в stderr; глушим, чтобы
    // не засорять output. Заодно проверяем, что warn реально вызывается
    // на невалидных URL.
    warnSpy = vi.spyOn(mainLogger, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('null config → []', () => {
    expect(computeAiOrigins(null)).toEqual([]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('openai-compatible https://api.openai.com/v1 → [https://api.openai.com]', () => {
    const cfg: AiProviderConfig = {
      mode: 'openai-compatible',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-4o-mini',
    };
    expect(computeAiOrigins(cfg)).toEqual(['https://api.openai.com']);
  });

  it('openai-compatible http://localhost:11434/v1 (Ollama) → [http://localhost:11434]', () => {
    const cfg: AiProviderConfig = {
      mode: 'openai-compatible',
      baseUrl: 'http://localhost:11434/v1',
      apiKey: '',
      model: 'llama3.1:8b',
    };
    expect(computeAiOrigins(cfg)).toEqual(['http://localhost:11434']);
  });

  it('openai-compatible trailing slash https://api.deepseek.com/v1/ → [https://api.deepseek.com]', () => {
    const cfg: AiProviderConfig = {
      mode: 'openai-compatible',
      baseUrl: 'https://api.deepseek.com/v1/',
      apiKey: 'k',
      model: 'deepseek-chat',
    };
    expect(computeAiOrigins(cfg)).toEqual(['https://api.deepseek.com']);
  });

  it('openai-compatible с custom port https://proxy.corp:8443/api → [https://proxy.corp:8443]', () => {
    const cfg: AiProviderConfig = {
      mode: 'openai-compatible',
      baseUrl: 'https://proxy.corp:8443/api',
      apiKey: 'k',
      model: 'm',
    };
    expect(computeAiOrigins(cfg)).toEqual(['https://proxy.corp:8443']);
  });

  it('qwen-web → [https://chat.qwen.ai] (baseUrl игнорируется)', () => {
    const cfg: AiProviderConfig = {
      mode: 'qwen-web',
      baseUrl: '',
      apiKey: '',
      qwenWebToken: 'token',
      model: 'qwen3-max',
    };
    expect(computeAiOrigins(cfg)).toEqual(['https://chat.qwen.ai']);
  });

  it('qwen-web с непустым baseUrl всё равно → [https://chat.qwen.ai]', () => {
    const cfg: AiProviderConfig = {
      mode: 'qwen-web',
      baseUrl: 'https://something-else.example',
      apiKey: '',
      qwenWebToken: 't',
      model: 'qwen3-max',
    };
    expect(computeAiOrigins(cfg)).toEqual(['https://chat.qwen.ai']);
  });

  it('невалидный baseUrl="not-a-url" → [] без throw, с warn', () => {
    const cfg: AiProviderConfig = {
      mode: 'openai-compatible',
      baseUrl: 'not-a-url',
      apiKey: '',
      model: 'm',
    };
    expect(() => computeAiOrigins(cfg)).not.toThrow();
    expect(computeAiOrigins(cfg)).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('openai-compatible без baseUrl → []', () => {
    const cfg: AiProviderConfig = {
      mode: 'openai-compatible',
      baseUrl: '',
      apiKey: '',
      model: 'm',
    };
    expect(computeAiOrigins(cfg)).toEqual([]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('openai-compatible с пробелами в baseUrl trim → []', () => {
    const cfg: AiProviderConfig = {
      mode: 'openai-compatible',
      baseUrl: '   ',
      apiKey: '',
      model: 'm',
    };
    expect(computeAiOrigins(cfg)).toEqual([]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('mode не задан — дефолт openai-compatible', () => {
    const cfg: AiProviderConfig = {
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'k',
      model: 'm',
    };
    expect(computeAiOrigins(cfg)).toEqual(['https://api.openai.com']);
  });
});
