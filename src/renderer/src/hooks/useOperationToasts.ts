import { useEffect, useRef } from 'react';
import { t, tpl } from '../i18n';
import { postCommand } from '../api';
import {
  classToSeverity,
  extractErrorHost,
  normalizeSource,
  resolveToastLevel,
  type ErrorSeverity,
  type OperationSource,
} from '@core/errors/severity';
import type { RendererCommand, GitErrorClass } from '../types';
import type { OperationResult } from './useAppState';
import type { SgToastAction } from '../ui/SgToast';

const SILENT_OPS = [
  'createBranch', 'deleteBranch', 'renameBranch', 'createTag', 'deleteTag',
  'addRemote', 'removeRemote', 'renameRemote', 'submoduleInit', 'submoduleUpdate',
  'clone', 'init',
];

const AGG_WINDOW_MS = 10_000;

interface AggBucket {
  count: number;
  host: string | null;
  maxSeverity: ErrorSeverity;
  maxSource: OperationSource;
  timer: ReturnType<typeof setTimeout>;
}

function severityRank(s: ErrorSeverity): number {
  if (s === 'critical') return 3;
  if (s === 'warning') return 2;
  return 1;
}

export interface UseOperationToastsOptions {
  /**
   * Если задан и вернёт `true` для текущей ошибки — toast НЕ показываем
   * (за неё уже отвечает SafetyDialog). Без этого юзер видит модалку
   * и параллельный toast с тем же stderr — ощущение «сломалось дважды».
   */
  willShowModal?: (args: {
    errorClass?: GitErrorClass;
    severity: ErrorSeverity;
    source: OperationSource;
    operation: string;
    error?: string;
  }) => boolean;
}

export function useOperationToasts(
  lastOpResult: OperationResult | null,
  clearLastOpResult: () => void,
  addToast: (
    msg: string,
    type: 'success' | 'error' | 'info' | 'warning',
    action?: SgToastAction,
  ) => void,
  lastCommandRef?: { current: RendererCommand | null },
  onShowActivity?: () => void,
  options?: UseOperationToastsOptions,
) {
  const aggRef = useRef<Map<string, AggBucket>>(new Map());

  useEffect(() => () => {
    for (const bucket of aggRef.current.values()) clearTimeout(bucket.timer);
    aggRef.current.clear();
  }, []);

  useEffect(() => {
    if (!lastOpResult) return;
    clearLastOpResult();
    const { operation, success, error, errorClass, severity: sevIn, source: srcIn } = lastOpResult;

    const ops = t().operations;
    if (success) {
      if (SILENT_OPS.includes(operation)) return;
      // Обновление чужой ветки — toast с именем, иначе «Fetch выполнен» бесполезен.
      if (operation === 'fetchBranch') {
        const cmd = lastCommandRef?.current;
        const branch = cmd?.type === 'fetchBranch' ? cmd.branch : '';
        addToast(
          branch
            ? tpl(ops.fetchBranchSuccess, { branch })
            : ops.fetchBranchSuccessFallback,
          'success',
        );
        return;
      }
      const msg: Record<string, string> = {
        fetch: ops.fetchSuccess, pull: ops.pullSuccess, push: ops.pushSuccess,
        stash: ops.stashSuccess, stashPop: ops.stashPopSuccess,
        commit: ops.commitSuccess, merge: ops.mergeSuccess, rebase: ops.rebaseSuccess,
        'cherry-pick': ops.cherryPickSuccess, revert: ops.revertSuccess,
        reset: ops.resetSuccess, checkout: ops.genericSuccess,
      };
      addToast(msg[operation] || tpl(ops.genericSuccess, { operation }), 'success');
      return;
    }

    const errorClassResolved = errorClass ?? 'unknown';
    const severity = sevIn ?? classToSeverity(errorClassResolved);
    const source = normalizeSource(srcIn);
    const toastLevel = resolveToastLevel(source, severity);
    if (toastLevel === null) return;

    // Если SafetyDialog (или другой источник) уже возьмёт эту ошибку —
    // toast подавляем, иначе получится дубль модалка+toast.
    if (options?.willShowModal?.({ errorClass, severity, source, operation, error })) return;

    const silentError = SILENT_OPS.includes(operation);
    if (silentError && severity === 'info') return;

    const host = (errorClassResolved === 'network' || errorClassResolved === 'auth')
      ? extractErrorHost(error ?? '')
      : null;
    const aggKey = host ? `${errorClassResolved}|${host}` : null;

    const showToast = (msg: string, level: typeof toastLevel, action?: SgToastAction) => {
      addToast(msg, level, action);
    };

    const buildRetryAction = (): SgToastAction | undefined => {
      if (!lastCommandRef?.current) return undefined;
      const cmd = lastCommandRef.current;
      return { label: t().safety.toastRetry, onClick: () => postCommand(cmd) };
    };

    const flushAgg = (key: string, bucket: AggBucket) => {
      aggRef.current.delete(key);
      const loc = t().errors;
      const hostPart = bucket.host ? ` (${bucket.host})` : '';
      const msg = bucket.count > 1
        ? tpl(loc.aggregatedFailures, { count: String(bucket.count), host: hostPart })
        : (error || tpl(ops.genericError, { operation }));
      const level = resolveToastLevel(bucket.maxSource, bucket.maxSeverity);
      if (level === null) return;
      const action: SgToastAction | undefined = onShowActivity
        ? { label: loc.showDetails, onClick: onShowActivity }
        : buildRetryAction();
      showToast(msg.slice(0, 80), level, action);
    };

    if (aggKey) {
      const existing = aggRef.current.get(aggKey);
      if (existing) {
        existing.count += 1;
        if (severityRank(severity) > severityRank(existing.maxSeverity)) {
          existing.maxSeverity = severity;
        }
        if (source === 'user') existing.maxSource = 'user';
        clearTimeout(existing.timer);
        existing.timer = setTimeout(() => flushAgg(aggKey, existing), AGG_WINDOW_MS);
        return;
      }
      const bucket: AggBucket = {
        count: 1,
        host,
        maxSeverity: severity,
        maxSource: source,
        timer: setTimeout(() => {
          const b = aggRef.current.get(aggKey);
          if (b) flushAgg(aggKey, b);
        }, AGG_WINDOW_MS),
      };
      aggRef.current.set(aggKey, bucket);
      return;
    }

    const msg = error || tpl(ops.genericError, { operation });
    const action = (severity !== 'info' && source === 'user') ? buildRetryAction() : undefined;
    showToast(msg.slice(0, 200), toastLevel, action);
  }, [lastOpResult, clearLastOpResult, addToast, lastCommandRef, onShowActivity]);
}
