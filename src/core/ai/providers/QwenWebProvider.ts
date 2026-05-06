import { randomUUID } from 'crypto';
import { AiError, type AiCompletionOptions, type AiCompletionResult, type AiProviderConfig } from '../types';
import type { AiProvider } from './base';
import { QWEN_WEB_DEFAULT_MODEL_ID, isQwenWebModelId } from '../qwenWebModels';
import { mainLogger } from '../../utils/Logger';

const QWEN_BASE = 'https://chat.qwen.ai';
const CREATE_CHAT_URL = `${QWEN_BASE}/api/v2/chats/new`;
const CHAT_COMPLETIONS_URL = `${QWEN_BASE}/api/v2/chat/completions`;

const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Неофициальный мост к chat.qwen.ai по сессионному токену из localStorage
 * (как провайдер qwen-web в Skycode). Без официального API-ключа DashScope.
 */
export class QwenWebProvider implements AiProvider {
  constructor(private readonly config: AiProviderConfig) {
    if ((config.mode ?? 'openai-compatible') !== 'qwen-web') {
      throw new AiError('QwenWebProvider: expected mode qwen-web', 'config');
    }
    if (!(config.qwenWebToken || '').trim()) {
      throw new AiError('Qwen Web: нужен токен сессии chat.qwen.ai', 'config');
    }
    if (!config.model?.trim()) {
      throw new AiError('model is required', 'config');
    }
  }

  private modelId(): string {
    const raw = this.config.model.trim();
    return isQwenWebModelId(raw) ? raw : QWEN_WEB_DEFAULT_MODEL_ID;
  }

  async testConnection(signal?: AbortSignal): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new AiError('timed out', 'timeout')), 10_000);
    const onExternal = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', onExternal);
    try {
      await this.createChat(controller.signal);
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onExternal);
    }
  }

  async complete(options: AiCompletionOptions): Promise<AiCompletionResult> {
    const controller = new AbortController();
    const externalAbort = options.signal;
    const timeoutMs = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const timeout = setTimeout(() => controller.abort(new AiError('request timed out', 'timeout')), timeoutMs);
    const onExternalAbort = () => controller.abort(externalAbort?.reason);
    externalAbort?.addEventListener('abort', onExternalAbort);

    const token = (this.config.qwenWebToken || '').trim();
    const modelId = this.modelId();

    try {
      const chatId = await this.createChat(controller.signal, token, modelId);
      return await this.chatCompletions(chatId, token, modelId, options, controller.signal);
    } catch (err) {
      throw wrapFetchError(err);
    } finally {
      clearTimeout(timeout);
      externalAbort?.removeEventListener('abort', onExternalAbort);
    }
  }

  private async createChat(signal: AbortSignal, token?: string, modelId?: string): Promise<string> {
    const t = (token ?? (this.config.qwenWebToken || '')).trim();
    const m = modelId ?? this.modelId();
    const payload = {
      title: 'SkyFork',
      models: [m],
      chat_mode: 'normal',
      chat_type: 't2t',
      timestamp: Date.now(),
    };

    const response = await fetch(CREATE_CHAT_URL, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${t}`,
        Accept: 'application/json, text/plain, */*',
        Origin: QWEN_BASE,
        Referer: `${QWEN_BASE}/`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await safeReadText(response);
      throw new AiError(
        `Qwen Web: create chat failed (${response.status}): ${truncate(body, 200)}`,
        'http',
        response.status,
      );
    }

    const data = (await response.json().catch(() => ({}))) as { data?: { id?: string }; id?: string };
    const chatId = data?.data?.id ?? data?.id;
    if (!chatId) {
      throw new AiError('Qwen Web: нет chat_id в ответе create chat', 'parse');
    }
    return chatId;
  }

  private async chatCompletions(
    chatId: string,
    token: string,
    modelId: string,
    options: AiCompletionOptions,
    signal: AbortSignal,
  ): Promise<AiCompletionResult> {
    const userMessageId = randomUUID();
    const assistantChildId = randomUUID();
    const nowSec = Math.floor(Date.now() / 1000);

    const newMessage = {
      fid: userMessageId,
      parentId: null,
      parent_id: null,
      role: 'user',
      content: options.userPrompt,
      chat_type: 't2t',
      sub_chat_type: 't2t',
      timestamp: nowSec,
      user_action: 'chat',
      models: [modelId],
      files: [],
      childrenIds: [assistantChildId],
      extra: { meta: { subChatType: 't2t' } },
      feature_config: { thinking_enabled: false, output_schema: 'phase' },
    };

    const payload: Record<string, unknown> = {
      stream: true,
      incremental_output: true,
      chat_id: chatId,
      chat_mode: 'normal',
      messages: [newMessage],
      model: modelId,
      parent_id: null,
      timestamp: nowSec,
    };

    if (options.systemPrompt) {
      payload.system_message = options.systemPrompt;
    }

    const url = `${CHAT_COMPLETIONS_URL}?chat_id=${chatId}`;
    const response = await fetch(url, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        Accept: 'text/event-stream',
        Origin: QWEN_BASE,
        Referer: `${QWEN_BASE}/c/${chatId}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errBody = await safeReadText(response);
      throw new AiError(
        `Qwen Web: ${response.status}: ${truncate(errBody, 500)}`,
        'http',
        response.status,
      );
    }

    if (!response.body) {
      throw new AiError('Qwen Web: пустой body ответа', 'parse');
    }

    return this.readSseStream(response.body, options);
  }

  private async readSseStream(body: ReadableStream<Uint8Array>, options: AiCompletionOptions): Promise<AiCompletionResult> {
    const reader = body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let text = '';
    let finishReason: AiCompletionResult['finishReason'] = 'stop';
    let usage: AiCompletionResult['usage'];
    let sawContent = false;

    const processEvent = (eventStr: string): void => {
      const dataLines = eventStr
        .split(/\r?\n/)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart());
      for (const jsonStr of dataLines) {
        if (!jsonStr || jsonStr === '[DONE]') continue;
        let chunk: unknown;
        try {
          chunk = JSON.parse(jsonStr);
        } catch {
          continue;
        }
        const c = chunk as Record<string, unknown>;
        if (c.code === 'RateLimited') {
          throw new AiError(`Qwen Web: rate limited`, 'http', 429);
        }
        if (c.error && !c.choices) {
          throw new AiError(`Qwen Web: ${JSON.stringify(c.error).slice(0, 300)}`, 'http');
        }
        const choice = (c.choices as Array<{ delta?: { content?: string }; finish_reason?: string }> | undefined)?.[0];
        const delta = choice?.delta;
        if (typeof delta?.content === 'string' && delta.content.length > 0) {
          sawContent = true;
          text += delta.content;
          options.onChunk?.(delta.content);
        }
        if (choice?.finish_reason) finishReason = mapFinishReason(choice.finish_reason);
        const u = c.usage as Record<string, number> | undefined;
        if (u) {
          usage = {
            promptTokens: u.prompt_tokens,
            completionTokens: u.completion_tokens,
            totalTokens: u.total_tokens,
          };
        }
      }
    };

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        for (;;) {
          const sep = findEventSeparator(buffer);
          if (!sep) break;
          const eventStr = buffer.slice(0, sep.index);
          buffer = buffer.slice(sep.index + sep.length);
          processEvent(eventStr);
        }
      }
      if (buffer.trim()) processEvent(buffer);
    } finally {
      reader.releaseLock();
    }

    if (!sawContent) {
      mainLogger.warn('Qwen Web: пустой ответ (токен истёк или лимит?)');
      throw new AiError(
        'Qwen Web: пустой ответ. Обновите токен в chat.qwen.ai (localStorage key token).',
        'parse',
      );
    }

    return { text, finishReason, usage };
  }
}

function findEventSeparator(buf: string): { index: number; length: number } | null {
  const a = buf.indexOf('\n\n');
  const b = buf.indexOf('\r\n\r\n');
  if (a === -1 && b === -1) return null;
  if (a === -1) return { index: b, length: 4 };
  if (b === -1) return { index: a, length: 2 };
  return a < b ? { index: a, length: 2 } : { index: b, length: 4 };
}

function mapFinishReason(raw: string): AiCompletionResult['finishReason'] {
  if (raw === 'stop' || raw === 'length') return raw;
  return 'stop';
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function isAbortError(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { name?: string }).name === 'AbortError';
}

function wrapFetchError(err: unknown): AiError {
  if (err instanceof AiError) return err;
  if (isAbortError(err)) return new AiError('request aborted', 'aborted');
  const msg = err instanceof Error ? err.message : String(err);
  return new AiError(msg, 'network');
}
