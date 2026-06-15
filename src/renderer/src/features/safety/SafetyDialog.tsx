import { useMemo } from 'react';
import { SgDialog } from '../../ui/SgDialog';
import { t, tpl } from '../../i18n';
import { stripAnsi } from '../../shared/stripAnsi';
import type {
  GitErrorClass,
  PreflightIssue,
  SavedOperationState,
  SuggestedAction,
} from '../../types';
import s from './SafetyDialog.module.css';

export interface SafetyDialogPayload {
  /**
   * Один из двух режимов:
   * - `failure`: операция уже стартовала и упала (errorClass + error +
   *   опционально preflightIssues если pre-flight блокнул).
   * - `preflight`: операция ещё не стартовала, но pre-flight нашёл блокеры.
   *   В этом случае error — описание-сводка, errorClass='preflight_blocked'.
   */
  operation: string;
  errorClass: GitErrorClass;
  error: string;
  savedState?: SavedOperationState;
  preflightIssues?: PreflightIssue[];
  suggestedActions: SuggestedAction[];
  /** Идёт ли запрос на main (показываем индикатор "выполняется..."). */
  busy?: boolean;
}

interface SafetyDialogProps {
  payload: SafetyDialogPayload | null;
  onAction(action: SuggestedAction): void;
  onClose(): void;
}

/**
 * Универсальный диалог для всех safety-кейсов. Не дублирует MergeBanner
 * (этот — модальный, явный выбор пути). Принимает payload и список
 * suggestedActions; кнопки маппит через i18n.
 *
 * UX: первая non-cancel/ignore-кнопка получает autoFocus и реагирует
 * на Enter — чтобы юзер мог быстро принять «безопасный default»
 * (continue/retry/remove_lock), как в Fork.
 */
export function SafetyDialog({ payload, onAction, onClose }: SafetyDialogProps) {
  const loc = t();

  const title = useMemo(() => {
    if (!payload) return '';
    return safetyTitle(payload.errorClass, loc);
  }, [payload, loc]);

  const primaryIndex = useMemo(() => {
    if (!payload) return -1;
    return payload.suggestedActions.findIndex(
      (a) => !isDangerKind(a.kind) && a.kind !== 'cancel' && a.kind !== 'ignore',
    );
  }, [payload]);

  if (!payload) return null;

  const description = safetyDescription(payload.errorClass, loc);

  return (
    <SgDialog
      open={true}
      title={title}
      onClose={onClose}
      width={560}
      footer={
        <div className={s.actions}>
          {payload.suggestedActions.map((act, i) => {
            const label = actionLabel(act, loc);
            const isDanger = isDangerKind(act.kind);
            const isPrimary = i === primaryIndex;
            const variant =
              act.kind === 'cancel' || act.kind === 'ignore' ? 'ghost'
                : isDanger ? 'danger'
                : 'primary';
            return (
              <button
                key={`${act.kind}-${i}`}
                // autoFocus на «безопасный default» (continue/retry/remove_lock),
                // браузер сам ставит focus после showModal() — без setTimeout.
                autoFocus={isPrimary}
                className={`sg-button sg-button--md sg-button--${variant}`}
                onClick={() => onAction(act)}
                disabled={payload.busy}
              >
                {label}
              </button>
            );
          })}
        </div>
      }
    >
      <div className={s.body}>
        {description && <div className={s.muted}>{description}</div>}

        {payload.preflightIssues && payload.preflightIssues.length > 0 && (
          <div className={s.section}>
            <div className={s.title}>{loc.safety.preflightSummary}</div>
            <ul className={s.list}>
              {payload.preflightIssues.map((iss, i) => (
                <li key={i}>
                  <div className={s.preflight}>
                    <div>{preflightDescription(iss, loc)}</div>
                    {iss.gitProcesses && iss.gitProcesses.length > 0 && (
                      <div className={s.muted} style={{ marginTop: 4 }}>
                        {loc.safety.gitProcesses}:
                        {iss.gitProcesses.map(p => (
                          <div key={p.pid} className={s.procRow}>pid {p.pid}: {p.command}</div>
                        ))}
                      </div>
                    )}
                    {iss.paths && iss.paths.length > 0 && (
                      <ul className={s.list}>
                        {iss.paths.slice(0, 10).map(p => <li key={p} className={s.procRow}>{p}</li>)}
                        {iss.paths.length > 10 && (
                          <li className={s.muted}>{tpl(loc.safety.morePaths, { n: String(iss.paths.length - 10) })}</li>
                        )}
                      </ul>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {payload.error && payload.errorClass !== 'preflight_blocked' && (
          <div className={s.section}>
            <div className={s.title}>{loc.safety.stderrTitle}</div>
            <div className={s.error}>{stripAnsi(payload.error)}</div>
          </div>
        )}

        {payload.savedState?.autoStashHash && (
          <div className={s.muted}>
            {tpl(loc.safety.autoStashSaved, { hash: payload.savedState.autoStashHash.slice(0, 7) })}
          </div>
        )}
      </div>
    </SgDialog>
  );
}

type Loc = ReturnType<typeof t>;

const DANGER_KINDS = new Set<SuggestedAction['kind']>([
  'kill_git_process', 'remove_lock', 'drop_stash', 'abort_merge', 'abort_rebase', 'rollback',
]);

function isDangerKind(kind: SuggestedAction['kind']): boolean {
  return DANGER_KINDS.has(kind);
}

function safetyTitle(cls: GitErrorClass, loc: Loc): string {
  const titles = loc.safety.titles;
  return (titles as Record<string, string>)[cls] || loc.safety.titles.unknown;
}

function safetyDescription(cls: GitErrorClass, loc: Loc): string {
  const descs = loc.safety.descriptions;
  return (descs as Record<string, string>)[cls] || '';
}

function preflightDescription(iss: PreflightIssue, loc: Loc): string {
  const labels = loc.safety.preflightKinds;
  const base = (labels as Record<string, string>)[iss.kind] || iss.description;
  return base;
}

function actionLabel(act: SuggestedAction, loc: Loc): string {
  if (act.label) return act.label;
  const map = loc.safety.actionLabels;
  return (map as Record<string, string>)[act.kind] || act.kind;
}
