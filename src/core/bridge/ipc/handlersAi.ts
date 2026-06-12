import type { HandlerTable } from './types';
import { AiError } from '../../ai/types';
import { SEMANTIC_SEARCH_SYSTEM_PROMPT } from '../../ai/prompts';

/** Усечь по символам с пометкой о пропущенных байтах — для длинных diff/reflog. */
function truncate(s: string, limit: number, label = 'truncated'): string {
  if (s.length <= limit) return s;
  return `${s.slice(0, limit)}\n\n... [${label}, ${s.length - limit} chars omitted] ...`;
}

/** Лимит на размер diff/reflog/conflict context, отправляемого в LLM. */
const MAX_DIFF_BYTES = 50_000;
const MAX_REFLOG_LINES = 100;
const MAX_CONFLICT_BLOB = 20_000;
const SEMANTIC_SEARCH_MAX_COMMITS_DEFAULT = 200;

/** AI-провайдер и генерация сообщений коммита. */
export const ipcHandlersAi: HandlerTable = {
  aiGetConfig: async (_cmd, ctx) => {
    if (!ctx.ai) {
      ctx.send({ type: 'aiConfig', config: null });
      return;
    }
    ctx.send({ type: 'aiConfig', config: ctx.ai.getConfig() });
  },

  aiSetConfig: async (cmd, ctx) => {
    if (!ctx.ai) return;
    try {
      await ctx.ai.setConfig(cmd.config);
      ctx.send({ type: 'aiConfig', config: ctx.ai.getConfig() });
    } catch (err) {
      ctx.send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  },

  aiTestConnection: async (cmd, ctx) => {
    if (!ctx.ai) {
      ctx.send({ type: 'aiTestResult', success: false, error: 'AI module unavailable' });
      return;
    }
    const res = await ctx.ai.testConnection(cmd.config);
    ctx.send({ type: 'aiTestResult', success: res.success, error: res.error });
  },

  aiTestPrompt: async (cmd, ctx) => {
    if (!ctx.ai) {
      ctx.send({ type: 'aiTestPromptResult', success: false, error: 'AI module unavailable', snapshot: null });
      return;
    }
    const res = await ctx.ai.testPrompt(cmd.config);
    ctx.send({ type: 'aiTestPromptResult', success: res.success, error: res.error, snapshot: res.snapshot });
  },

  aiGetLastDebug: async (_cmd, ctx) => {
    if (!ctx.ai) {
      ctx.send({ type: 'aiLastDebug', snapshot: null });
      return;
    }
    ctx.send({ type: 'aiLastDebug', snapshot: ctx.ai.getLastDebug() });
  },

  aiGenerateCommitMessage: async (cmd, ctx) => {
    const requestId = cmd.requestId;
    if (!ctx.ai) {
      ctx.send({ type: 'aiError', requestId, message: 'AI module unavailable', kind: 'config' });
      return;
    }
    const repoPath = ctx.sm.getState().repoPath;
    if (!repoPath) {
      ctx.send({ type: 'aiError', requestId, message: 'No repository open', kind: 'config' });
      return;
    }
    let diff: string;
    try {
      const res = await ctx.sm.getGit().exec(['diff', '--cached', '--no-color'], { cwd: repoPath });
      diff = res.stdout ?? '';
    } catch (err) {
      ctx.send({
        type: 'aiError',
        requestId,
        message: err instanceof Error ? err.message : String(err),
        kind: 'config',
      });
      return;
    }
    if (!diff.trim()) {
      ctx.send({ type: 'aiError', requestId, message: 'Nothing is staged', kind: 'config' });
      return;
    }
    try {
      // Commit message generation is post-processed before display. Do not
      // stream raw model chunks here: corporate/Qwen gateways may expose
      // visible reasoning before the final cleaned Conventional Commit block.
      const { text, finishReason } = await ctx.ai.generateCommitMessage(requestId, diff, () => {});
      ctx.send({ type: 'aiDone', requestId, text, finishReason });
    } catch (err) {
      const kind = err instanceof AiError ? err.kind : 'error';
      const message = err instanceof Error ? err.message : String(err);
      ctx.send({ type: 'aiError', requestId, message, kind });
    }
  },

  aiCancelGenerate: async (cmd, ctx) => {
    ctx.ai?.cancel(cmd.requestId);
  },

  aiExplainCommit: async (cmd, ctx) => {
    const { requestId, hash } = cmd;
    if (!ctx.ai) {
      ctx.send({ type: 'aiError', requestId, message: 'AI module unavailable', kind: 'config' });
      return;
    }
    try {
      const detail = await ctx.ch.getCommitDetails(hash);
      // Diff собираем как сумму per-file diff'ов первых N файлов: cheap, без лишних git-вызовов.
      // Большой merge-commit может дать десятки тысяч строк — обрезаем до MAX_DIFF_BYTES.
      const fileDiffs: string[] = [];
      let used = 0;
      for (const f of detail.files) {
        if (used >= MAX_DIFF_BYTES) break;
        const diffs = await ctx.ch.getFileDiff(f.path, hash);
        for (const fd of diffs) {
          const header = fd.oldPath && fd.oldPath !== fd.path
            ? `--- ${fd.oldPath} -> ${fd.path}`
            : `--- ${fd.path}`;
          const block = header + '\n' +
            fd.hunks.flatMap(h => [h.header, ...h.lines.map(l => `${l.type === 'add' ? '+' : l.type === 'remove' ? '-' : ' '}${l.content}`)]).join('\n');
          fileDiffs.push(block);
          used += block.length;
          if (used >= MAX_DIFF_BYTES) break;
        }
      }
      const truncatedDiff = truncate(fileDiffs.join('\n\n'), MAX_DIFF_BYTES, 'diff truncated');
      /* Stash-entry или иной случай без diff: даём модели максимум контекста
         из subject/body + список затронутых файлов, чтобы она не отвечала
         «(diff truncated)» в каждую секцию. */
      const userBody = truncatedDiff.trim().length > 0
        ? truncatedDiff
        : [
            `[No diff available for ${hash.slice(0, 7)} — it may be a stash entry, a merge with no textual changes, or an unfetched commit.]`,
            detail.files.length > 0
              ? `Files touched (${detail.files.length}):\n${detail.files.slice(0, 30).map((f) => `- ${f.path}`).join('\n')}`
              : 'No file list available.',
          ].join('\n\n');
      const res = await ctx.ai.runFeature({
        requestId,
        featureId: 'explainCommit',
        promptId: 'explainCommit',
        placeholders: { subject: detail.subject, body: detail.body ?? '' },
        userBody,
        onChunk: (delta) => ctx.send({ type: 'aiChunk', requestId, delta }),
      });
      ctx.send({ type: 'aiDone', requestId, text: res.text, finishReason: res.finishReason });
    } catch (err) {
      const kind = err instanceof AiError ? err.kind : 'error';
      const message = err instanceof Error ? err.message : String(err);
      ctx.send({ type: 'aiError', requestId, message, kind });
    }
  },

  aiExplainReflog: async (cmd, ctx) => {
    const { requestId } = cmd;
    if (!ctx.ai) {
      ctx.send({ type: 'aiError', requestId, message: 'AI module unavailable', kind: 'config' });
      return;
    }
    try {
      const entries = await ctx.ch.getReflog(cmd.maxCount ?? MAX_REFLOG_LINES);
      if (entries.length === 0) {
        ctx.send({ type: 'aiDone', requestId, text: 'Reflog is empty — nothing to explain.', finishReason: 'stop' });
        return;
      }
      const body = entries
        .map((e) => `HEAD@{${e.index}}: ${e.action} ${e.shortHash} ${e.message ?? ''} (${e.date})`.trim())
        .join('\n');
      const res = await ctx.ai.runFeature({
        requestId,
        featureId: 'explainReflog',
        promptId: 'explainReflog',
        placeholders: {},
        userBody: truncate(body, MAX_DIFF_BYTES, 'reflog truncated'),
        onChunk: (delta) => ctx.send({ type: 'aiChunk', requestId, delta }),
      });
      ctx.send({ type: 'aiDone', requestId, text: res.text, finishReason: res.finishReason });
    } catch (err) {
      const kind = err instanceof AiError ? err.kind : 'error';
      const message = err instanceof Error ? err.message : String(err);
      ctx.send({ type: 'aiError', requestId, message, kind });
    }
  },

  aiAnalyzeConflict: async (cmd, ctx) => {
    const { requestId, file } = cmd;
    if (!ctx.ai) {
      ctx.send({ type: 'aiError', requestId, message: 'AI module unavailable', kind: 'config' });
      return;
    }
    try {
      const content = await ctx.ch.getConflictContent(file);
      const conflictBlocks = content.blocks.filter((b) => b.type === 'conflict');
      if (conflictBlocks.length === 0) {
        ctx.send({ type: 'aiDone', requestId, text: 'No conflict markers detected in this file.', finishReason: 'stop' });
        return;
      }
      const body = [
        `FILE: ${file}`,
        '',
        '=== HEAD (ours) ===',
        truncate(conflictBlocks.map((b) => b.ours).join('\n'), MAX_CONFLICT_BLOB),
        '',
        '=== MERGE (theirs) ===',
        truncate(conflictBlocks.map((b) => b.theirs).join('\n'), MAX_CONFLICT_BLOB),
      ].join('\n');
      const res = await ctx.ai.runFeature({
        requestId,
        featureId: 'analyzeConflict',
        promptId: 'analyzeConflict',
        placeholders: {},
        userBody: body,
        onChunk: (delta) => ctx.send({ type: 'aiChunk', requestId, delta }),
      });
      ctx.send({ type: 'aiDone', requestId, text: res.text, finishReason: res.finishReason });
    } catch (err) {
      const kind = err instanceof AiError ? err.kind : 'error';
      const message = err instanceof Error ? err.message : String(err);
      ctx.send({ type: 'aiError', requestId, message, kind });
    }
  },

  aiSuggestStashName: async (_cmd, ctx) => {
    if (!ctx.ai) {
      ctx.send({ type: 'aiStashNameResult', success: false, error: 'AI module unavailable' });
      return;
    }
    const repoPath = ctx.sm.getState().repoPath;
    if (!repoPath) {
      ctx.send({ type: 'aiStashNameResult', success: false, error: 'No repository open' });
      return;
    }
    try {
      const stagedRes = await ctx.sm.getGit().exec(['diff', '--cached', '--no-color'], { cwd: repoPath });
      const unstagedRes = await ctx.sm.getGit().exec(['diff', '--no-color'], { cwd: repoPath });
      const diff = [stagedRes.stdout ?? '', unstagedRes.stdout ?? ''].join('\n').trim();
      if (!diff) {
        ctx.send({ type: 'aiStashNameResult', success: false, error: 'Nothing to stash' });
        return;
      }
      const text = await ctx.ai.runFeatureOnce({
        featureId: 'stashName',
        promptId: 'stashName',
        userBody: truncate(diff, 30_000, 'diff truncated'),
        maxTokens: 32,
      });
      const cleaned = text.replace(/^["'`«]+|["'`».]+$/g, '').trim().slice(0, 80);
      ctx.send({ type: 'aiStashNameResult', success: true, name: cleaned });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.send({ type: 'aiStashNameResult', success: false, error: message });
    }
  },

  aiSemanticSearch: async (cmd, ctx) => {
    if (!ctx.ai) {
      ctx.send({ type: 'aiSemanticSearchResult', success: false, error: 'AI module unavailable' });
      return;
    }
    const repoPath = ctx.sm.getState().repoPath;
    if (!repoPath) {
      ctx.send({ type: 'aiSemanticSearchResult', success: false, error: 'No repository open' });
      return;
    }
    try {
      // TODO(ai-tier2-future): replace with proper embedding-based search.
      // MVP: brute-force LLM rerank over the most recent N commits (default 200).
      // Cheap to ship, works on any provider (no embedding endpoint required),
      // breaks down on long histories (subject+body only, no diff).
      const max = Math.min(Math.max(cmd.maxCommits ?? SEMANTIC_SEARCH_MAX_COMMITS_DEFAULT, 1), 500);
      const fmt = '%H%x1f%s%x1f%b%x1e';
      const logRes = await ctx.sm.getGit().exec(['log', `-${max}`, `--pretty=format:${fmt}`, '-z'], { cwd: repoPath });
      const entries = (logRes.stdout ?? '')
        .split('\x1e')
        .map((e) => e.trim())
        .filter(Boolean)
        .map((e, idx) => {
          const [hash, subject, body] = e.split('\x1f');
          return { idx: idx + 1, hash, subject: (subject ?? '').trim(), body: (body ?? '').trim() };
        });
      if (entries.length === 0) {
        ctx.send({ type: 'aiSemanticSearchResult', success: true, hashes: [] });
        return;
      }
      const userBody = [
        `Query: ${cmd.query}`,
        '',
        'Commits:',
        entries.map((e) => `${e.idx}. ${e.hash}\n   subject: ${e.subject}\n   body: ${truncate(e.body, 600)}`).join('\n\n'),
      ].join('\n');
      const text = await ctx.ai.runRawPromptOnce({
        featureId: 'semanticSearch',
        systemPrompt: SEMANTIC_SEARCH_SYSTEM_PROMPT,
        userBody,
        temperature: 0.1,
        maxTokens: 800,
      });
      const hashes = (text ?? '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .map((line) => line.replace(/^[0-9]+\.\s*/, ''))
        .map((line) => line.replace(/[^0-9a-f]/gi, ''))
        .filter((h) => /^[0-9a-f]{7,40}$/i.test(h));
      // Сохраняем порядок ответа модели; убираем дубликаты.
      const seen = new Set<string>();
      const uniq: string[] = [];
      for (const h of hashes) {
        // Расширяем 7-символьные prefix'ы до полных hash'ей, если найдены среди наших entries.
        const full = entries.find((e) => e.hash.startsWith(h))?.hash ?? h;
        if (!seen.has(full)) { seen.add(full); uniq.push(full); }
      }
      ctx.send({ type: 'aiSemanticSearchResult', success: true, hashes: uniq.slice(0, 20) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.send({ type: 'aiSemanticSearchResult', success: false, error: message });
    }
  },
};
