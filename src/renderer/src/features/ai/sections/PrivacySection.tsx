import { t } from '../../../i18n';
import s from '../AiSettingsDialog.module.css';

interface Props {
  aiEnabled: boolean;
  allowCloudCodeShare: boolean;
  onAiEnabledChange: (v: boolean) => void;
  onAllowCloudCodeShareChange: (v: boolean) => void;
}

/**
 * Раздел «Приватность»: глобальный AI kill-switch и разрешение на
 * отправку кода в зарубежные провайдеры. Локальные / российские /
 * без-VPN провайдеры НЕ подпадают под `allowCloudCodeShare` — это
 * сознательный outscope (см. ADR в
 * `docs/tasks/ai-settings-redesign-todo.md`).
 */
export function PrivacySection({ aiEnabled, allowCloudCodeShare, onAiEnabledChange, onAllowCloudCodeShareChange }: Props) {
  const loc = t().ai;
  return (
    <div className={s.section}>
      <div className={s.field}>
        <label className={s.checkLine}>
          <input
            type="checkbox"
            checked={aiEnabled}
            onChange={(e) => onAiEnabledChange(e.target.checked)}
            aria-label={loc.aiEnabled}
          />
          <span>
            <div>{loc.aiEnabled}</div>
            <div className={s.hint}>{loc.aiEnabledHint}</div>
          </span>
        </label>
      </div>

      <div className={s.field}>
        <label className={s.checkLine}>
          <input
            type="checkbox"
            checked={allowCloudCodeShare}
            onChange={(e) => onAllowCloudCodeShareChange(e.target.checked)}
            aria-label={loc.allowCloudCodeShare}
          />
          <span>
            <div>{loc.allowCloudCodeShare}</div>
            <div className={s.hint}>{loc.allowCloudCodeShareHint}</div>
          </span>
        </label>
      </div>
    </div>
  );
}
