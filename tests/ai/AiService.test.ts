import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AiService } from '../../src/core/ai/AiService';
import { AiError } from '../../src/core/ai/types';

type FetchMock = ReturnType<typeof vi.fn>;
let fetchMock: FetchMock;

function mockJsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    statusText: ok ? 'OK' : 'Error',
    json: async () => body,
    text: async () => JSON.stringify(body),
    body: null,
  } as unknown as Response;
}

beforeEach(() => {
  fetchMock = vi.fn();
  (globalThis as { fetch: FetchMock }).fetch = fetchMock;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AiService.isConfigured', () => {
  it('false when config is null', () => {
    expect(new AiService(null).isConfigured()).toBe(false);
  });
  it('false when baseUrl missing', () => {
    expect(new AiService({ baseUrl: '', apiKey: '', model: 'm' }).isConfigured()).toBe(false);
  });
  it('true for minimal valid config', () => {
    expect(new AiService({ baseUrl: 'http://x/v1', apiKey: '', model: 'm' }).isConfigured()).toBe(true);
  });
});

describe('AiService.generateCommitMessage', () => {
  it('throws when diff is empty', async () => {
    const svc = new AiService({ baseUrl: 'http://x/v1', apiKey: 'k', model: 'm' });
    await expect(svc.generateCommitMessage({ diff: '   ' })).rejects.toThrow(AiError);
  });

  it('throws when not configured', async () => {
    const svc = new AiService(null);
    await expect(svc.generateCommitMessage({ diff: 'x' })).rejects.toMatchObject({ kind: 'config' });
  });

  it('strips markdown code fences from response', async () => {
    fetchMock.mockResolvedValueOnce(
      mockJsonResponse({
        choices: [{ message: { content: '```\nfix bug in parser\n```' }, finish_reason: 'stop' }],
      }),
    );
    const svc = new AiService({ baseUrl: 'http://x/v1', apiKey: 'k', model: 'm' });
    const res = await svc.generateCommitMessage({ diff: 'diff --git a/x b/x\n+hi' });
    expect(res.text).toBe('fix bug in parser');
  });

  it('strips surrounding quotes', async () => {
    fetchMock.mockResolvedValueOnce(
      mockJsonResponse({
        choices: [{ message: { content: '"add AI support"' }, finish_reason: 'stop' }],
      }),
    );
    const svc = new AiService({ baseUrl: 'http://x/v1', apiKey: 'k', model: 'm' });
    const res = await svc.generateCommitMessage({ diff: 'x' });
    expect(res.text).toBe('add AI support');
  });

  it('includes system prompt and diff in request', async () => {
    fetchMock.mockResolvedValueOnce(
      mockJsonResponse({ choices: [{ message: { content: 'msg' }, finish_reason: 'stop' }] }),
    );
    const svc = new AiService({ baseUrl: 'http://x/v1', apiKey: 'k', model: 'm' });
    await svc.generateCommitMessage({ diff: 'DIFF_CONTENT_123' });
    const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[1].role).toBe('user');
    expect(body.messages[1].content).toContain('DIFF_CONTENT_123');
  });

  it('uses low default temperature (0.3) for deterministic commit messages', async () => {
    fetchMock.mockResolvedValueOnce(
      mockJsonResponse({ choices: [{ message: { content: 'x' }, finish_reason: 'stop' }] }),
    );
    const svc = new AiService({ baseUrl: 'http://x/v1', apiKey: 'k', model: 'm' });
    await svc.generateCommitMessage({ diff: 'x' });
    const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
    expect(body.temperature).toBe(0.3);
    expect(body.max_tokens).toBeUndefined();
  });
});

describe('AiService.setConfig / getConfig', () => {
  it('updates config dynamically', () => {
    const svc = new AiService(null);
    expect(svc.isConfigured()).toBe(false);
    svc.setConfig({ baseUrl: 'http://x/v1', apiKey: '', model: 'm' });
    expect(svc.isConfigured()).toBe(true);
    expect(svc.getConfig()?.model).toBe('m');
  });
});
