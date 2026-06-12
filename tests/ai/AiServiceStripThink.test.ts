import { describe, it, expect, vi, afterEach } from 'vitest';
import { AiService } from '../../src/core/ai/AiService';
import type { AiCompletionResult, AiProviderConfig } from '../../src/core/ai/types';

class FakeProvider {
  constructor(public res: AiCompletionResult) {}
  async complete(): Promise<AiCompletionResult> { return this.res; }
  async testConnection(): Promise<void> {}
}

afterEach(() => vi.restoreAllMocks());

function makeService(cfg: AiProviderConfig, providerRes: AiCompletionResult): AiService {
  const svc = new AiService(cfg);
  vi.spyOn(svc as unknown as { ensureProvider(): unknown }, 'ensureProvider')
    .mockReturnValue(new FakeProvider(providerRes));
  return svc;
}

const cfg: AiProviderConfig = {
  mode: 'openai-compatible', baseUrl: 'http://x/v1', apiKey: '', model: 'm',
  stripThinkTags: true,
};

describe('AiService stripThinkTags', () => {
  it('removes <think> blocks from final text', async () => {
    const svc = makeService(cfg, {
      text: '<think>plan plan</think>feat: hello',
      finishReason: 'stop',
    });
    const r = await svc.generateCommitMessage({ diff: 'x\n' });
    expect(r.text).toBe('feat: hello');
  });

  it('extracts the last conventional commit after visible reasoning', async () => {
    const svc = makeService(cfg, {
      text: [
        "Here's a thinking process:",
        '',
        '1. Analyze user input.',
        '2. Pick a type.',
        '',
        'fix(ai): исправить генерацию commit message',
        '',
        'Убирает reasoning из ответа корпоративной модели.',
      ].join('\n'),
      finishReason: 'stop',
    });
    const r = await svc.generateCommitMessage({ diff: 'x\n' });
    expect(r.text).toBe([
      'fix(ai): исправить генерацию commit message',
      '',
      'Убирает reasoning из ответа корпоративной модели.',
    ].join('\n'));
  });

  it('prefers the final commit block when the model drafts one before reasoning', async () => {
    const svc = makeService(cfg, {
      text: [
        'chore(gitignore): обновите правила игнорирования и удалите артефакты',
        '',
        '- All good.',
        '- Output matches.',
        '- Self-Correction: the prompt says type and scope must be ASCII.',
        '',
        'chore(gitignore): обновите правила игнорирования и удалите артефакты',
        '',
        'Шаблон release*/ упрощает поддержку новых сборок.',
        'Удалены устаревшие файлы и добавлены тесты для парсера.',
      ].join('\n'),
      finishReason: 'stop',
    });
    const r = await svc.generateCommitMessage({ diff: 'x\n' });
    expect(r.text).toBe([
      'chore(gitignore): обновите правила игнорирования и удалите артефакты',
      '',
      'Шаблон release*/ упрощает поддержку новых сборок.',
      'Удалены устаревшие файлы и добавлены тесты для парсера.',
    ].join('\n'));
  });

  it('throws if response is empty and systemInUser already on (no fallback possible)', async () => {
    const svc = makeService({ ...cfg, systemInUser: true }, {
      text: '',
      finishReason: 'stop',
    });
    await expect(svc.generateCommitMessage({ diff: 'x\n' }))
      .rejects.toThrow(/Empty response from gateway/);
  });
});
