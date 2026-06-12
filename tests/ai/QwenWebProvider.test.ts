import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QwenWebProvider } from '../../src/core/ai/providers/QwenWebProvider';
import { AiError, type AiProviderConfig } from '../../src/core/ai/types';

type FetchMock = ReturnType<typeof vi.fn>;
let fetchMock: FetchMock;

function mockJsonResponse(body: unknown, ok = true, status = 200): Response {
  const text = JSON.stringify(body);
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: async () => JSON.parse(text),
    text: async () => text,
    body: null,
  } as unknown as Response;
}

function mockTextResponse(body: string, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: async () => {
      throw new Error('not json');
    },
    text: async () => body,
    body: null,
  } as unknown as Response;
}

function mockSseResponse(events: string[], ok = true, status = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const e of events) controller.enqueue(encoder.encode(e));
      controller.close();
    },
  });
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: async () => {
      throw new Error('not json');
    },
    text: async () => '',
    body: stream,
  } as unknown as Response;
}

/**
 * Хелпер: мок последовательно отвечает на createChat (json), затем completions (sse).
 */
function mockHappyFlow(events: string[], chatId = 'chat-123'): void {
  fetchMock
    .mockResolvedValueOnce(mockJsonResponse({ data: { id: chatId } }))
    .mockResolvedValueOnce(mockSseResponse(events));
}

const baseConfig: AiProviderConfig = {
  mode: 'qwen-web',
  baseUrl: 'https://chat.qwen.ai',
  apiKey: '',
  qwenWebToken: 'test-token',
  model: 'qwen3-max',
};

beforeEach(() => {
  fetchMock = vi.fn();
  (globalThis as { fetch: FetchMock }).fetch = fetchMock;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('QwenWebProvider constructor', () => {
  it('throws if mode is not qwen-web', () => {
    expect(
      () => new QwenWebProvider({ ...baseConfig, mode: 'openai-compatible' }),
    ).toThrow(AiError);
  });

  it('throws if qwenWebToken is missing', () => {
    expect(() => new QwenWebProvider({ ...baseConfig, qwenWebToken: '' })).toThrow(AiError);
  });

  it('throws if qwenWebToken is whitespace only', () => {
    expect(() => new QwenWebProvider({ ...baseConfig, qwenWebToken: '   ' })).toThrow(AiError);
  });

  it('throws if model is missing', () => {
    expect(() => new QwenWebProvider({ ...baseConfig, model: '' })).toThrow(AiError);
  });
});

describe('QwenWebProvider.testConnection', () => {
  it('succeeds when create-chat returns 200 with id', async () => {
    fetchMock.mockResolvedValueOnce(mockJsonResponse({ data: { id: 'abc' } }));
    const p = new QwenWebProvider(baseConfig);
    await p.testConnection();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('chat.qwen.ai');
    expect(url).toContain('/api/v2/chats/new');
    expect((init as RequestInit).method).toBe('POST');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-token');
  });

  it('accepts chat_id from create-chat response', async () => {
    fetchMock.mockResolvedValueOnce(mockJsonResponse({ data: { chat_id: 'abc' } }));
    const p = new QwenWebProvider(baseConfig);
    await p.testConnection();
  });

  it('sends Qwen Web cookie when configured', async () => {
    fetchMock.mockResolvedValueOnce(mockJsonResponse({ data: { id: 'abc' } }));
    const p = new QwenWebProvider({ ...baseConfig, qwenWebCookie: 'ssxmod_itna=abc; other=1' });
    await p.testConnection();
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Cookie).toBe('ssxmod_itna=abc; other=1');
  });

  it('reports Aliyun WAF challenge as HTTP-like error', async () => {
    fetchMock.mockResolvedValueOnce(mockTextResponse('<!doctypehtml><meta name="aliyun_waf_aa" content="x">'));
    const p = new QwenWebProvider(baseConfig);
    await expect(p.testConnection()).rejects.toMatchObject({
      message: expect.stringContaining('Aliyun WAF'),
      kind: 'http',
      status: 403,
    });
  });

  it('throws AiError with kind=http when 401 received', async () => {
    fetchMock.mockResolvedValueOnce(mockJsonResponse({ message: 'Unauthorized' }, false, 401));
    const p = new QwenWebProvider(baseConfig);
    await expect(p.testConnection()).rejects.toMatchObject({
      kind: 'http',
      status: 401,
    });
  });

  it('throws AiError with kind=parse when response has no chat id', async () => {
    fetchMock.mockResolvedValueOnce(mockJsonResponse({ message: 'token expired' }));
    const p = new QwenWebProvider(baseConfig);
    await expect(p.testConnection()).rejects.toMatchObject({
      message: expect.stringContaining('token expired'),
      kind: 'parse',
    });
  });
});

describe('QwenWebProvider.complete', () => {
  it('streams chunks via onChunk and aggregates full text', async () => {
    mockHappyFlow([
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":", world"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ]);
    const p = new QwenWebProvider(baseConfig);
    const chunks: string[] = [];
    const res = await p.complete({ userPrompt: 'hi', onChunk: (c) => chunks.push(c) });
    expect(res.text).toBe('Hello, world');
    expect(chunks).toEqual(['Hello', ', world']);
    expect(res.finishReason).toBe('stop');
  });

  it('parses usage block when present in stream', async () => {
    mockHappyFlow([
      'data: {"choices":[{"delta":{"content":"x"}}]}\n\n',
      'data: {"usage":{"prompt_tokens":5,"completion_tokens":1,"total_tokens":6}}\n\n',
      'data: [DONE]\n\n',
    ]);
    const p = new QwenWebProvider(baseConfig);
    const res = await p.complete({ userPrompt: 'hi' });
    expect(res.usage).toEqual({ promptTokens: 5, completionTokens: 1, totalTokens: 6 });
  });

  it('sends Authorization header with token in completions request', async () => {
    mockHappyFlow([
      'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
      'data: [DONE]\n\n',
    ]);
    const p = new QwenWebProvider(baseConfig);
    await p.complete({ userPrompt: 'hi' });
    const completionsCall = fetchMock.mock.calls[1];
    const headers = (completionsCall[1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-token');
    expect(headers.Accept).toBe('text/event-stream');
  });

  it('falls back to default model when configured model is unknown', async () => {
    mockHappyFlow([
      'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
      'data: [DONE]\n\n',
    ]);
    const p = new QwenWebProvider({ ...baseConfig, model: 'no-such-model' });
    await p.complete({ userPrompt: 'hi' });
    const createBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(createBody.models).toEqual(['qwen3-max']);
  });

  it('throws AiError with kind=http on completions HTTP error', async () => {
    fetchMock
      .mockResolvedValueOnce(mockJsonResponse({ data: { id: 'c1' } }))
      .mockResolvedValueOnce(mockJsonResponse({ error: 'forbidden' }, false, 403));
    const p = new QwenWebProvider(baseConfig);
    await expect(p.complete({ userPrompt: 'hi' })).rejects.toMatchObject({
      kind: 'http',
      status: 403,
    });
  });

  it('detects RateLimited inside SSE chunk', async () => {
    mockHappyFlow([
      'data: {"code":"RateLimited","message":"slow down"}\n\n',
    ]);
    const p = new QwenWebProvider(baseConfig);
    await expect(p.complete({ userPrompt: 'hi' })).rejects.toMatchObject({
      kind: 'http',
      status: 429,
    });
  });

  it('throws kind=parse when stream had zero content (token expired etc.)', async () => {
    mockHappyFlow([
      'data: {"choices":[{"delta":{}}]}\n\n',
      'data: [DONE]\n\n',
    ]);
    const p = new QwenWebProvider(baseConfig);
    await expect(p.complete({ userPrompt: 'hi' })).rejects.toMatchObject({ kind: 'parse' });
  });

  it('ignores malformed JSON chunks and continues parsing', async () => {
    mockHappyFlow([
      'data: {"choices":[{"delta":{"content":"a"}}]}\n\n',
      'data: {broken json\n\n',
      'data: {"choices":[{"delta":{"content":"b"}}]}\n\n',
      'data: [DONE]\n\n',
    ]);
    const p = new QwenWebProvider(baseConfig);
    const res = await p.complete({ userPrompt: 'hi' });
    expect(res.text).toBe('ab');
  });

  it('aborts the stream via external AbortSignal without leaking the underlying abort', async () => {
    const ctrl = new AbortController();
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const sig = init.signal!;
      // Simulate fetch that is aborted while waiting.
      return await new Promise<Response>((_, reject) => {
        sig.addEventListener('abort', () => {
          const err = new Error('aborted');
          (err as Error & { name: string }).name = 'AbortError';
          reject(err);
        });
      });
    });
    const p = new QwenWebProvider(baseConfig);
    const promise = p.complete({ userPrompt: 'hi', signal: ctrl.signal });
    setTimeout(() => ctrl.abort(), 5);
    await expect(promise).rejects.toMatchObject({ kind: 'aborted' });
  });

  it('wraps generic network errors as AiError kind=network', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'));
    const p = new QwenWebProvider(baseConfig);
    await expect(p.complete({ userPrompt: 'hi' })).rejects.toMatchObject({ kind: 'network' });
  });
});
