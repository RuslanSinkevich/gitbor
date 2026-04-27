import { AiError, type AiCompletionOptions, type AiCompletionResult, type AiProviderConfig } from '../types';
import type { AiProvider } from './base';

const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Провайдер поверх OpenAI-compatible API (`POST {baseUrl}/chat/completions`).
 * Покрывает: OpenAI, Ollama, LM Studio, vLLM, LiteLLM, Groq, DeepSeek,
 * корпоративные gateway'и и любые совместимые сервисы.
 *
 * Реализация намеренно без SDK: чистый fetch + ручной SSE-парсер. Это
 * убирает зависимости, избегает несовместимостей между версиями openai-sdk
 * и ведёт себя одинаково на всех серверах.
 */
export class OpenAiCompatibleProvider implements AiProvider {
  constructor(private readonly config: AiProviderConfig) {
    if (!config.baseUrl) {
      throw new AiError('baseUrl is required', 'config');
    }
    if (!config.model) {
      throw new AiError('model is required', 'config');
    }
  }

  async complete(options: AiCompletionOptions): Promise<AiCompletionResult> {
    const stream = typeof options.onChunk === 'function';
    const body = this.buildRequestBody(options, stream);
    const url = this.buildUrl('/chat/completions');

    const controller = new AbortController();
    const externalAbort = options.signal;
    const timeoutMs = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const timeout = setTimeout(() => controller.abort(new AiError('request timed out', 'timeout')), timeoutMs);
    const onExternalAbort = () => controller.abort(externalAbort?.reason);
    externalAbort?.addEventListener('abort', onExternalAbort);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: this.buildHeaders(stream),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeout);
      externalAbort?.removeEventListener('abort', onExternalAbort);
      throw wrapFetchError(err);
    }

    try {
      if (!response.ok) {
        const text = await safeReadText(response);
        throw new AiError(
          `HTTP ${response.status}: ${truncate(text, 500) || response.statusText}`,
          'http',
          response.status,
        );
      }
      if (stream) return await this.readStream(response, options);
      return await this.readJson(response);
    } finally {
      clearTimeout(timeout);
      externalAbort?.removeEventListener('abort', onExternalAbort);
    }
  }

  async testConnection(signal?: AbortSignal): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new AiError('timed out', 'timeout')), 10_000);
    const onAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', onAbort);
    try {
      const url = this.buildUrl('/models');
      const res = await fetch(url, { method: 'GET', headers: this.buildHeaders(false), signal: controller.signal });
      if (!res.ok) {
        throw new AiError(`HTTP ${res.status}: ${res.statusText}`, 'http', res.status);
      }
    } catch (err) {
      throw wrapFetchError(err);
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  private buildUrl(path: string): string {
    const base = this.config.baseUrl.replace(/\/+$/, '');
    const p = path.startsWith('/') ? path : `/${path}`;
    return base + p;
  }

  private buildHeaders(stream: boolean): Record<string, string> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: stream ? 'text/event-stream' : 'application/json',
      ...(this.config.headers ?? {}),
    };
    if (this.config.apiKey) headers.authorization = `Bearer ${this.config.apiKey}`;
    return headers;
  }

  private buildRequestBody(options: AiCompletionOptions, stream: boolean): Record<string, unknown> {
    const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
    if (options.systemPrompt) messages.push({ role: 'system', content: options.systemPrompt });
    messages.push({ role: 'user', content: options.userPrompt });
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages,
      stream,
    };
    if (options.temperature !== undefined) body.temperature = options.temperature;
    if (options.maxTokens !== undefined) body.max_tokens = options.maxTokens;
    return body;
  }

  private async readJson(response: Response): Promise<AiCompletionResult> {
    let data: any;
    try {
      data = await response.json();
    } catch {
      throw new AiError('malformed JSON response', 'parse');
    }
    const choice = data?.choices?.[0];
    const text = choice?.message?.content ?? '';
    if (typeof text !== 'string') throw new AiError('missing choices[0].message.content', 'parse');
    return {
      text,
      finishReason: mapFinishReason(choice?.finish_reason),
      usage: mapUsage(data?.usage),
    };
  }

  private async readStream(response: Response, options: AiCompletionOptions): Promise<AiCompletionResult> {
    if (!response.body) throw new AiError('streaming body is empty', 'parse');
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let text = '';
    let finishReason: AiCompletionResult['finishReason'] = 'stop';
    let usage: AiCompletionResult['usage'];
    let eventCount = 0;
    let byteCount = 0;
    console.log('[SkyFork AI] stream start, content-type:', response.headers?.get?.('content-type'));

    const processEvent = (eventStr: string): boolean => {
      eventCount++;
      if (eventCount <= 3) console.log('[SkyFork AI] event #%d raw:', eventCount, eventStr);
      const dataLines = eventStr
        .split(/\r?\n/)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart());
      for (const payload of dataLines) {
        if (payload === '[DONE]') return true;
        try {
          const chunk = JSON.parse(payload);
          const choice = chunk?.choices?.[0];
          // OpenAI / Ollama / vLLM кладут стриминговый контент в delta.content.
          // llama.cpp-сервер иногда шлёт `content` или legacy-формат `text`.
          const delta =
            choice?.delta?.content ??
            choice?.delta?.reasoning_content ??
            choice?.content ??
            choice?.text ??
            chunk?.content ??
            chunk?.response;
          if (typeof delta === 'string' && delta.length > 0) {
            text += delta;
            options.onChunk?.(delta);
          }
          if (choice?.finish_reason) finishReason = mapFinishReason(choice.finish_reason);
          if (chunk?.usage) usage = mapUsage(chunk.usage);
          // Ollama-native non-SSE кадр: `done: true` вне OpenAI-структуры.
          if (chunk?.done === true) return true;
        } catch {
          // битый JSON в SSE — пропускаем и идём дальше
        }
      }
      return false;
    };

    let rawSample = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        byteCount += value?.byteLength ?? 0;
        const decoded = decoder.decode(value, { stream: true });
        if (rawSample.length < 1500) rawSample += decoded.slice(0, 1500 - rawSample.length);
        buffer += decoded;
        for (;;) {
          const sep = findEventSeparator(buffer);
          if (!sep) break;
          const eventStr = buffer.slice(0, sep.index);
          buffer = buffer.slice(sep.index + sep.length);
          if (processEvent(eventStr)) {
            console.log('[SkyFork AI] stream done. bytes=%d events=%d textLen=%d', byteCount, eventCount, text.length);
            return { text, finishReason, usage };
          }
        }
      }
      // Хвост без финального \n\n — некоторые серверы не шлют trailing newlines.
      if (buffer.trim()) processEvent(buffer);
      console.log('[SkyFork AI] stream eof. bytes=%d events=%d textLen=%d', byteCount, eventCount, text.length);
      if (!text) {
        console.warn('[SkyFork AI] empty result. Raw head (first 1500B):\n', rawSample);
      }
    } catch (err) {
      if (isAbortError(err)) {
        return { text, finishReason: 'aborted', usage };
      }
      throw wrapFetchError(err);
    } finally {
      reader.releaseLock();
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

function mapFinishReason(raw: unknown): AiCompletionResult['finishReason'] {
  if (raw === 'stop' || raw === 'length') return raw;
  return 'stop';
}

function mapUsage(raw: unknown): AiCompletionResult['usage'] | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const u = raw as Record<string, unknown>;
  return {
    promptTokens: numOrUndef(u.prompt_tokens),
    completionTokens: numOrUndef(u.completion_tokens),
    totalTokens: numOrUndef(u.total_tokens),
  };
}

function numOrUndef(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
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
