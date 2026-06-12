import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AiHandlers, applyPlaceholders } from '../../src/core/ai/AiHandlers';
import { AiService } from '../../src/core/ai/AiService';
import { AiError, type AiProviderConfig } from '../../src/core/ai/types';

function makeStore() {
  return {
    load: vi.fn(() => null),
    save: vi.fn(async () => {}),
    clear: vi.fn(async () => {}),
  };
}

function makeService(initial: AiProviderConfig | null = null): AiService {
  return new AiService(initial);
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  (globalThis as { fetch: unknown }).fetch = fetchMock;
});

describe('AiHandlers.getConfig', () => {
  it('returns null when no config', () => {
    const h = new AiHandlers(makeService(null), makeStore() as never);
    expect(h.getConfig()).toBeNull();
  });

  it('masks apiKey in response', () => {
    const h = new AiHandlers(
      makeService({ baseUrl: 'http://x/v1', apiKey: 'sk-super', model: 'm' }),
      makeStore() as never,
    );
    const cfg = h.getConfig();
    expect(cfg?.baseUrl).toBe('http://x/v1');
    expect(cfg?.apiKey).toBe('••••••••');
    expect(cfg?.model).toBe('m');
  });

  it('returns empty apiKey when none was set (no bogus mask)', () => {
    const h = new AiHandlers(
      makeService({ baseUrl: 'http://x/v1', apiKey: '', model: 'm' }),
      makeStore() as never,
    );
    expect(h.getConfig()?.apiKey).toBe('');
  });

  it('does not expose disabled qwen-web config to UI', () => {
    const h = new AiHandlers(
      makeService({
        mode: 'qwen-web',
        baseUrl: 'https://chat.qwen.ai',
        apiKey: '',
        qwenWebToken: 'tok-secret',
        model: 'qwen3-max',
      }),
      makeStore() as never,
    );
    const cfg = h.getConfig();
    expect(cfg).toBeNull();
  });
});

describe('AiHandlers.setConfig', () => {
  it('rejects disabled qwen-web config', async () => {
    const service = makeService(null);
    const h = new AiHandlers(service, makeStore() as never);
    await expect(h.setConfig({
      mode: 'qwen-web',
      baseUrl: 'https://chat.qwen.ai',
      apiKey: '',
      qwenWebToken: 'tok',
      model: 'qwen3-max',
    })).rejects.toMatchObject({ kind: 'config' });
    expect(service.getConfig()).toBeNull();
  });

  it('null clears both service and store', async () => {
    const service = makeService({ baseUrl: 'http://x/v1', apiKey: 'k', model: 'm' });
    const store = makeStore();
    const h = new AiHandlers(service, store as never);
    await h.setConfig(null);
    expect(service.getConfig()).toBeNull();
    expect(store.clear).toHaveBeenCalled();
  });

  it('saves new config and updates service', async () => {
    const service = makeService(null);
    const store = makeStore();
    const h = new AiHandlers(service, store as never);
    await h.setConfig({ baseUrl: 'http://x/v1', apiKey: 'k', model: 'm' });
    expect(service.getConfig()).toEqual({
      mode: 'openai-compatible',
      baseUrl: 'http://x/v1',
      apiKey: 'k',
      model: 'm',
    });
    expect(store.save).toHaveBeenCalledWith({
      mode: 'openai-compatible',
      baseUrl: 'http://x/v1',
      apiKey: 'k',
      model: 'm',
    });
  });

  it('preserves existing apiKey when UI sends empty (editing baseUrl only)', async () => {
    const service = makeService({ baseUrl: 'http://x/v1', apiKey: 'sk-old', model: 'm' });
    const store = makeStore();
    const h = new AiHandlers(service, store as never);
    await h.setConfig({ baseUrl: 'http://y/v1', apiKey: '', model: 'm2' });
    expect(service.getConfig()?.apiKey).toBe('sk-old');
    expect(service.getConfig()?.baseUrl).toBe('http://y/v1');
  });

  it('preserves existing apiKey when UI sends masked bullets', async () => {
    const service = makeService({ baseUrl: 'http://x/v1', apiKey: 'sk-old', model: 'm' });
    const h = new AiHandlers(service, makeStore() as never);
    await h.setConfig({ baseUrl: 'http://x/v1', apiKey: '••••••••', model: 'm' });
    expect(service.getConfig()?.apiKey).toBe('sk-old');
  });

  it('replaces apiKey when UI provides a real new value', async () => {
    const service = makeService({ baseUrl: 'http://x/v1', apiKey: 'sk-old', model: 'm' });
    const h = new AiHandlers(service, makeStore() as never);
    await h.setConfig({ baseUrl: 'http://x/v1', apiKey: 'sk-new', model: 'm' });
    expect(service.getConfig()?.apiKey).toBe('sk-new');
  });
});

describe('AiHandlers.testConnection', () => {
  it('returns success on 200', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({}),
      text: async () => '',
      body: null,
    });
    const h = new AiHandlers(makeService(null), makeStore() as never);
    const res = await h.testConnection({ baseUrl: 'http://x/v1', apiKey: 'k', model: 'm' });
    expect(res.success).toBe(true);
  });

  it('returns error on non-200', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: async () => ({}),
      text: async () => '',
      body: null,
    });
    const h = new AiHandlers(makeService(null), makeStore() as never);
    const res = await h.testConnection({ baseUrl: 'http://x/v1', apiKey: 'k', model: 'm' });
    expect(res.success).toBe(false);
    expect(res.error).toContain('401');
  });
});

describe('AiHandlers.generateCommitMessage', () => {
  it('throws AiError(config) when not configured', async () => {
    const h = new AiHandlers(makeService(null), makeStore() as never);
    await expect(h.generateCommitMessage('r1', 'diff', () => {})).rejects.toMatchObject({ kind: 'config' });
  });

  it('forwards chunks via onChunk callback', async () => {
    const encoder = new TextEncoder();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => '',
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"fix"}}]}\n\n'));
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":" bug"}}]}\n\n'));
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      }),
    });
    const h = new AiHandlers(
      makeService({ baseUrl: 'http://x/v1', apiKey: 'k', model: 'm' }),
      makeStore() as never,
    );
    const chunks: string[] = [];
    const res = await h.generateCommitMessage('r1', 'some diff', (d) => chunks.push(d));
    expect(chunks).toEqual(['fix', ' bug']);
    expect(res.text).toBe('fix bug');
  });

  it('cancel aborts an in-flight request by id', async () => {
    let abortedInFetch = false;
    fetchMock.mockImplementationOnce((_url, init) => {
      return new Promise((_resolve, reject) => {
        (init as RequestInit).signal?.addEventListener('abort', () => {
          abortedInFetch = true;
          const e = new Error('aborted');
          (e as { name: string }).name = 'AbortError';
          reject(e);
        });
      });
    });
    const h = new AiHandlers(
      makeService({ baseUrl: 'http://x/v1', apiKey: 'k', model: 'm' }),
      makeStore() as never,
    );
    const promise = h.generateCommitMessage('r1', 'd', () => {});
    await new Promise((r) => setTimeout(r, 5));
    h.cancel('r1');
    await expect(promise).rejects.toBeInstanceOf(AiError);
    expect(abortedInFetch).toBe(true);
  });

  it('blocks foreign provider when allowCloudCodeShare=false', async () => {
    const h = new AiHandlers(
      makeService({
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk',
        model: 'gpt-4o-mini',
        allowCloudCodeShare: false,
      }),
      makeStore() as never,
    );
    await expect(h.generateCommitMessage('r1', 'd', () => {}))
      .rejects.toMatchObject({ kind: 'config', message: expect.stringMatching(/Allow sending code/) });
  });

  it('allows foreign provider when allowCloudCodeShare=true', async () => {
    const encoder = new TextEncoder();
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200, statusText: 'OK', text: async () => '',
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"ok"}}]}\n\n'));
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      }),
    });
    const h = new AiHandlers(
      makeService({
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk',
        model: 'gpt-4o-mini',
        allowCloudCodeShare: true,
      }),
      makeStore() as never,
    );
    const res = await h.generateCommitMessage('r1', 'diff', () => {});
    expect(res.text).toBe('ok');
  });

  it('always allows local provider regardless of allowCloudCodeShare', async () => {
    const encoder = new TextEncoder();
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200, statusText: 'OK', text: async () => '',
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"ok"}}]}\n\n'));
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      }),
    });
    const h = new AiHandlers(
      makeService({
        baseUrl: 'http://localhost:11434/v1',
        apiKey: '',
        model: 'llama3.1:8b',
        allowCloudCodeShare: false,
      }),
      makeStore() as never,
    );
    const res = await h.generateCommitMessage('r1', 'diff', () => {});
    expect(res.text).toBe('ok');
  });

  it('blocks when aiEnabled=false', async () => {
    const h = new AiHandlers(
      makeService({
        baseUrl: 'http://x/v1',
        apiKey: '',
        model: 'm',
        aiEnabled: false,
      }),
      makeStore() as never,
    );
    await expect(h.generateCommitMessage('r1', 'd', () => {}))
      .rejects.toMatchObject({ kind: 'config', message: expect.stringMatching(/AI is disabled/) });
  });

  it('blocks when features.commitMessage=false', async () => {
    const h = new AiHandlers(
      makeService({
        baseUrl: 'http://x/v1',
        apiKey: '',
        model: 'm',
        features: { commitMessage: false },
      }),
      makeStore() as never,
    );
    await expect(h.generateCommitMessage('r1', 'd', () => {}))
      .rejects.toMatchObject({ kind: 'config', message: expect.stringMatching(/Commit message generation is disabled/) });
  });

  it('cancelAll aborts all in-flight requests', async () => {
    let aborts = 0;
    fetchMock.mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        (init as RequestInit).signal?.addEventListener('abort', () => {
          aborts++;
          const e = new Error('aborted');
          (e as { name: string }).name = 'AbortError';
          reject(e);
        });
      });
    });
    const h = new AiHandlers(
      makeService({ baseUrl: 'http://x/v1', apiKey: 'k', model: 'm' }),
      makeStore() as never,
    );
    const p1 = h.generateCommitMessage('r1', 'd', () => {});
    const p2 = h.generateCommitMessage('r2', 'd', () => {});
    await new Promise((r) => setTimeout(r, 5));
    h.cancelAll();
    await expect(Promise.allSettled([p1, p2])).resolves.toBeDefined();
    expect(aborts).toBe(2);
  });
});

describe('applyPlaceholders', () => {
  it('substitutes {key} with value', () => {
    expect(applyPlaceholders('Hello {name}', { name: 'world' })).toBe('Hello world');
  });
  it('handles multiple occurrences', () => {
    expect(applyPlaceholders('{a}+{a}={b}', { a: '1', b: '2' })).toBe('1+1=2');
  });
  it('leaves unknown placeholders intact', () => {
    expect(applyPlaceholders('Hi {name} from {place}', { name: 'X' })).toBe('Hi X from {place}');
  });
  it('handles empty vars map', () => {
    expect(applyPlaceholders('plain text', {})).toBe('plain text');
  });
});

describe('AiHandlers.runFeature (Tier-2 streaming)', () => {
  it('rejects unconfigured service', async () => {
    const h = new AiHandlers(makeService(null), makeStore() as never);
    await expect(
      h.runFeature({
        requestId: 'r1', featureId: 'explainCommit', promptId: 'explainCommit',
        placeholders: {}, userBody: 'x', onChunk: () => {},
      }),
    ).rejects.toMatchObject({ kind: 'config' });
  });

  it('blocks foreign provider w/o allowCloudCodeShare', async () => {
    const h = new AiHandlers(
      makeService({
        baseUrl: 'https://api.openai.com/v1', apiKey: 'sk', model: 'm',
        features: { explainCommit: true },
      }),
      makeStore() as never,
    );
    await expect(
      h.runFeature({
        requestId: 'r1', featureId: 'explainCommit', promptId: 'explainCommit',
        placeholders: {}, userBody: 'x', onChunk: () => {},
      }),
    ).rejects.toMatchObject({ kind: 'config' });
  });

  it('blocks when feature toggle is false', async () => {
    const h = new AiHandlers(
      makeService({
        baseUrl: 'http://x/v1', apiKey: '', model: 'm',
        features: { explainCommit: false },
      }),
      makeStore() as never,
    );
    await expect(
      h.runFeature({
        requestId: 'r1', featureId: 'explainCommit', promptId: 'explainCommit',
        placeholders: {}, userBody: 'x', onChunk: () => {},
      }),
    ).rejects.toMatchObject({ kind: 'config', message: expect.stringMatching(/disabled/) });
  });

  it('streams tokens and resolves text on success', async () => {
    const encoder = new TextEncoder();
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200, statusText: 'OK', text: async () => '',
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'));
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"!"}}]}\n\n'));
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      }),
    });
    const h = new AiHandlers(
      makeService({
        baseUrl: 'http://x/v1', apiKey: '', model: 'm',
        features: { explainCommit: true },
      }),
      makeStore() as never,
    );
    const chunks: string[] = [];
    const res = await h.runFeature({
      requestId: 'r1', featureId: 'explainCommit', promptId: 'explainCommit',
      placeholders: { subject: 'fix', body: '' }, userBody: 'diff',
      onChunk: (d) => chunks.push(d),
    });
    expect(chunks).toEqual(['hi', '!']);
    expect(res.text).toBe('hi!');
  });
});
