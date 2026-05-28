import type { AiDebugSnapshot } from '@core/ai/types';
import { t, tpl } from '../../../i18n';
import s from '../AiSettingsDialog.module.css';

interface Props {
  debugLogging: boolean;
  busy: boolean;
  snapshot: AiDebugSnapshot | null;
  testStatus: 'idle' | 'testing' | 'ok' | 'fail';
  testError?: string;
  onDebugLoggingChange: (v: boolean) => void;
  onTestPrompt: () => void;
  onShowLast: () => void;
}

/**
 * Раздел «Диагностика»: debug-логирование, прогон тестового промпта,
 * показ последнего request/response. Существующая логика (отправка
 * `aiTestPrompt`, подписка на `aiLastDebug`) живёт в Dialog —
 * сюда передаём готовые значения и callback'и.
 */
export function DebugSection(props: Props) {
  const loc = t().ai;
  return (
    <div className={s.section}>
      <div className={s.field}>
        <label className={s.checkLine}>
          <input
            type="checkbox"
            checked={props.debugLogging}
            onChange={(e) => props.onDebugLoggingChange(e.target.checked)}
            aria-label={loc.debugMode}
          />
          <span>
            <div>{loc.debugMode}</div>
          </span>
        </label>
      </div>

      <div className={s.field}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="sg-button sg-button--ghost sg-button--sm"
            type="button"
            onClick={props.onTestPrompt}
            disabled={props.busy}
          >
            {loc.testPrompt}
          </button>
          <button
            className="sg-button sg-button--ghost sg-button--sm"
            type="button"
            onClick={props.onShowLast}
          >
            {loc.showLastRequest}
          </button>
        </div>
        {props.busy && <div className={s.statusInfo}>{loc.testing}</div>}
        {props.testStatus === 'ok' && !props.busy && <div className={s.statusOk}>{loc.testOk}</div>}
        {props.testStatus === 'fail' && !props.busy && (
          <div className={s.statusFail}>{tpl(loc.testFailed, { error: props.testError ?? '' })}</div>
        )}
        {props.snapshot && (
          <pre className={s.debugPre}>{JSON.stringify(props.snapshot, null, 2)}</pre>
        )}
      </div>
    </div>
  );
}
