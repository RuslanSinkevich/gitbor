import { describe, it, expect, vi, afterEach } from 'vitest';
import { OpenAiCompatibleProvider } from '../../src/core/ai/providers/OpenAiCompatibleProvider';
import type { AiProviderConfig } from '../../src/core/ai/types';

function mockFetchJson(body: unknown): typeof globalThis.fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), {
    status: 200, headers: { 'content-type': 'application/json' },
  })) as unknown as typeof globalThis.fetch;
}

afterEach(() => {
  vi.restoreAllMocks();
});

const baseCfg: AiProviderConfig = {
  mode: 'openai-compatible',
  baseUrl: 'http://x/v1',
  apiKey: '',
  model: 'm',
};

const okResponse = { choices: [{ message: { content: 'feat: x' }, finish_reason: 'stop' }] };

describe('OpenAiCompatibleProvider request body', () => {
  it('default: separate system + user messages', async () => {
    const fetchSpy = mockFetchJson(okResponse);
    vi.stubGlobal('fetch', fetchSpy);
    const p = new OpenAiCompatibleProvider(baseCfg);
    await p.complete({ systemPrompt: 'SYS', userPrompt: 'USR' });
    const body = JSON.parse((fetchSpy as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.messages).toEqual([
      { role: 'system', content: 'SYS' },
      { role: 'user', content: 'USR' },
    ]);
  });

  it('systemInUser=true: merges system into single user message', async () => {
    const fetchSpy = mockFetchJson(okResponse);
    vi.stubGlobal('fetch', fetchSpy);
    const p = new OpenAiCompatibleProvider({ ...baseCfg, systemInUser: true });
    await p.complete({ systemPrompt: 'SYS', userPrompt: 'USR' });
    const body = JSON.parse((fetchSpy as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.messages).toEqual([{ role: 'user', content: 'SYS\n\nUSR' }]);
  });

  it('qwenDisableThinking adds extra_body.enable_thinking=false', async () => {
    const fetchSpy = mockFetchJson(okResponse);
    vi.stubGlobal('fetch', fetchSpy);
    const p = new OpenAiCompatibleProvider({ ...baseCfg, qwenDisableThinking: true });
    await p.complete({ userPrompt: 'x' });
    const body = JSON.parse((fetchSpy as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.extra_body).toEqual({ enable_thinking: false });
  });

  it('extraBody is merged into top-level body', async () => {
    const fetchSpy = mockFetchJson(okResponse);
    vi.stubGlobal('fetch', fetchSpy);
    const p = new OpenAiCompatibleProvider({ ...baseCfg, extraBody: { parameters: { user: 'me' } } });
    await p.complete({ userPrompt: 'x' });
    const body = JSON.parse((fetchSpy as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.parameters).toEqual({ user: 'me' });
  });

  it('debugSink captures request and response', async () => {
    const fetchSpy = mockFetchJson(okResponse);
    vi.stubGlobal('fetch', fetchSpy);
    const p = new OpenAiCompatibleProvider(baseCfg);
    const snapshots: unknown[] = [];
    await p.complete({ userPrompt: 'x', debugSink: (s) => snapshots.push(s) });
    expect(snapshots).toHaveLength(1);
    const snap = snapshots[0] as { request: { model: string }; responseJson?: unknown };
    expect(snap.request.model).toBe('m');
    expect(snap.responseJson).toBeDefined();
  });
});
