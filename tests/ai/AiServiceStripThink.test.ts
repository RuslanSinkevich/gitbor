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

  it('throws if response is empty and systemInUser already on (no fallback possible)', async () => {
    const svc = makeService({ ...cfg, systemInUser: true }, {
      text: '',
      finishReason: 'stop',
    });
    await expect(svc.generateCommitMessage({ diff: 'x\n' }))
      .rejects.toThrow(/Empty response from gateway/);
  });
});
