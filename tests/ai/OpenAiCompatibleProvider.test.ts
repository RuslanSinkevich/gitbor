import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAiCompatibleProvider } from '../../src/core/ai/providers/OpenAiCompatibleProvider';
import { AiError } from '../../src/core/ai/types';

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

function mockSseResponse(events: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const e of events) controller.enqueue(encoder.encode(e));
      controller.close();
    },
  });
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => {
      throw new Error('not json');
    },
    text: async () => '',
    body: stream,
  } as unknown as Response;
}

beforeEach(() => {
  fetchMock = vi.fn();
  (globalThis as { fetch: FetchMock }).fetch = fetchMock;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('OpenAiCompatibleProvider constructor', () => {
  it('throws if baseUrl missing', () => {
    expect(() => new OpenAiCompatibleProvider({ baseUrl: '', apiKey: '', model: 'm' })).toThrow(AiError);
  });
  it('throws if model missing', () => {
    expect(() => new OpenAiCompatibleProvider({ baseUrl: 'http://x/v1', apiKey: '', model: '' })).toThrow(AiError);
  });
});

describe('OpenAiCompatibleProvider.complete (non-streaming)', () => {
  it('parses standard OpenAI chat.completions response', async () => {
    fetchMock.mockResolvedValueOnce(
      mockJsonResponse({
        choices: [{ message: { content: 'hello world' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      }),
    );
    const p = new OpenAiCompatibleProvider({ baseUrl: 'http://x/v1', apiKey: 'k', model: 'gpt' });
    const res = await p.complete({ userPrompt: 'hi' });
    expect(res.text).toBe('hello world');
    expect(res.finishReason).toBe('stop');
    expect(res.usage).toEqual({ promptTokens: 5, completionTokens: 2, totalTokens: 7 });
  });

  it('sends Authorization header when apiKey present', async () => {
    fetchMock.mockResolvedValueOnce(mockJsonResponse({ choices: [{ message: { content: 'ok' } }] }));
    const p = new OpenAiCompatibleProvider({ baseUrl: 'http://x/v1', apiKey: 'sk-123', model: 'm' });
    await p.complete({ userPrompt: 'x' });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer sk-123');
  });

  it('omits Authorization when apiKey empty (local Ollama case)', async () => {
    fetchMock.mockResolvedValueOnce(mockJsonResponse({ choices: [{ message: { content: 'ok' } }] }));
    const p = new OpenAiCompatibleProvider({ baseUrl: 'http://localhost:11434/v1', apiKey: '', model: 'llama3' });
    await p.complete({ userPrompt: 'x' });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
  });

  it('includes system prompt when provided', async () => {
    fetchMock.mockResolvedValueOnce(mockJsonResponse({ choices: [{ message: { content: 'ok' } }] }));
    const p = new OpenAiCompatibleProvider({ baseUrl: 'http://x/v1', apiKey: 'k', model: 'm' });
    await p.complete({ userPrompt: 'u', systemPrompt: 's' });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body.messages).toEqual([
      { role: 'system', content: 's' },
      { role: 'user', content: 'u' },
    ]);
  });

  it('normalizes trailing slashes in baseUrl', async () => {
    fetchMock.mockResolvedValueOnce(mockJsonResponse({ choices: [{ message: { content: 'ok' } }] }));
    const p = new OpenAiCompatibleProvider({ baseUrl: 'http://x/v1///', apiKey: 'k', model: 'm' });
    await p.complete({ userPrompt: 'x' });
    expect(fetchMock.mock.calls[0][0]).toBe('http://x/v1/chat/completions');
  });

  it('throws AiError with HTTP status on 4xx/5xx', async () => {
    fetchMock.mockResolvedValueOnce(mockJsonResponse({ error: { message: 'bad key' } }, false, 401));
    const p = new OpenAiCompatibleProvider({ baseUrl: 'http://x/v1', apiKey: 'k', model: 'm' });
    await expect(p.complete({ userPrompt: 'x' })).rejects.toMatchObject({ kind: 'http', status: 401 });
  });

  it('wraps network errors as AiError kind=network', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const p = new OpenAiCompatibleProvider({ baseUrl: 'http://x/v1', apiKey: 'k', model: 'm' });
    await expect(p.complete({ userPrompt: 'x' })).rejects.toMatchObject({ kind: 'network' });
  });

  it('passes temperature and max_tokens through to body', async () => {
    fetchMock.mockResolvedValueOnce(mockJsonResponse({ choices: [{ message: { content: 'ok' } }] }));
    const p = new OpenAiCompatibleProvider({ baseUrl: 'http://x/v1', apiKey: 'k', model: 'm' });
    await p.complete({ userPrompt: 'x', temperature: 0.7, maxTokens: 123 });
    const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
    expect(body.temperature).toBe(0.7);
    expect(body.max_tokens).toBe(123);
    expect(body.stream).toBe(false);
  });
});

describe('OpenAiCompatibleProvider.complete (streaming SSE)', () => {
  it('accumulates delta chunks and returns full text', async () => {
    fetchMock.mockResolvedValueOnce(
      mockSseResponse([
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":", world"}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
        'data: [DONE]\n\n',
      ]),
    );
    const p = new OpenAiCompatibleProvider({ baseUrl: 'http://x/v1', apiKey: 'k', model: 'm' });
    const chunks: string[] = [];
    const res = await p.complete({ userPrompt: 'hi', onChunk: (d) => chunks.push(d) });
    expect(res.text).toBe('Hello, world');
    expect(chunks).toEqual(['Hello', ', world']);
    expect(res.finishReason).toBe('stop');
  });

  it('sets stream=true in request body when onChunk provided', async () => {
    fetchMock.mockResolvedValueOnce(mockSseResponse(['data: [DONE]\n\n']));
    const p = new OpenAiCompatibleProvider({ baseUrl: 'http://x/v1', apiKey: 'k', model: 'm' });
    await p.complete({ userPrompt: 'hi', onChunk: () => {} });
    const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
    expect(body.stream).toBe(true);
  });

  it('ignores malformed JSON chunks and continues', async () => {
    fetchMock.mockResolvedValueOnce(
      mockSseResponse([
        'data: {"choices":[{"delta":{"content":"a"}}]}\n\n',
        'data: {broken json\n\n',
        'data: {"choices":[{"delta":{"content":"b"}}]}\n\n',
        'data: [DONE]\n\n',
      ]),
    );
    const p = new OpenAiCompatibleProvider({ baseUrl: 'http://x/v1', apiKey: 'k', model: 'm' });
    const res = await p.complete({ userPrompt: 'x', onChunk: () => {} });
    expect(res.text).toBe('ab');
  });
});

describe('OpenAiCompatibleProvider.testConnection', () => {
  it('hits /models endpoint and passes on 200', async () => {
    fetchMock.mockResolvedValueOnce(mockJsonResponse({ data: [] }));
    const p = new OpenAiCompatibleProvider({ baseUrl: 'http://x/v1', apiKey: 'k', model: 'm' });
    await p.testConnection();
    expect(fetchMock.mock.calls[0][0]).toBe('http://x/v1/models');
    expect(fetchMock.mock.calls[0][1]!.method).toBe('GET');
  });

  it('throws AiError on non-200', async () => {
    fetchMock.mockResolvedValueOnce(mockJsonResponse({}, false, 500));
    const p = new OpenAiCompatibleProvider({ baseUrl: 'http://x/v1', apiKey: 'k', model: 'm' });
    await expect(p.testConnection()).rejects.toMatchObject({ kind: 'http', status: 500 });
  });
});
