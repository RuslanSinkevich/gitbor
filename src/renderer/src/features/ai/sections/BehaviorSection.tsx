import type { AiResponseLanguage } from '@core/ai/types';
import { t } from '../../../i18n';
import s from '../AiSettingsDialog.module.css';

interface Props {
  responseLanguage: AiResponseLanguage;
  systemInUser: boolean;
  qwenDisableThinking: boolean;
  stripThinkTags: boolean;
  onResponseLanguageChange: (v: AiResponseLanguage) => void;
  onSystemInUserChange: (v: boolean) => void;
  onQwenDisableThinkingChange: (v: boolean) => void;
  onStripThinkTagsChange: (v: boolean) => void;
}

/**
 * Раздел «Поведение»: общий язык ответа AI (единый для всех фич — заменил
 * старый `commitLanguage`) и совместимость с corporate gateway'ями
 * (system-in-user, qwen-disable-thinking, strip-think-tags).
 */
export function BehaviorSection(props: Props) {
  const loc = t().ai;
  return (
    <div className={s.section}>
      <label className={s.field}>
        <span className={s.label}>{loc.aiResponseLanguage}</span>
        <select
          className="sg-select"
          value={props.responseLanguage}
          onChange={(e) => props.onResponseLanguageChange(e.target.value as AiResponseLanguage)}
        >
          <option value="auto">{loc.aiResponseLanguageAuto}</option>
          <option value="en">{loc.aiResponseLanguageEn}</option>
          <option value="ru">{loc.aiResponseLanguageRu}</option>
        </select>
        <span className={s.hint}>{loc.aiResponseLanguageHint}</span>
      </label>

      <div className={s.field}>
        <span className={s.label}>{loc.advanced}</span>
        <label className={s.checkLine}>
          <input
            type="checkbox"
            checked={props.systemInUser}
            onChange={(e) => props.onSystemInUserChange(e.target.checked)}
            aria-label={loc.systemInUser}
          />
          <span>
            <div>{loc.systemInUser}</div>
            <div className={s.hint}>{loc.systemInUserHint}</div>
          </span>
        </label>
        <label className={s.checkLine}>
          <input
            type="checkbox"
            checked={props.qwenDisableThinking}
            onChange={(e) => props.onQwenDisableThinkingChange(e.target.checked)}
            aria-label={loc.qwenDisableThinking}
          />
          <span>
            <div>{loc.qwenDisableThinking}</div>
          </span>
        </label>
        <label className={s.checkLine}>
          <input
            type="checkbox"
            checked={props.stripThinkTags}
            onChange={(e) => props.onStripThinkTagsChange(e.target.checked)}
            aria-label={loc.stripThinkTags}
          />
          <span>
            <div>{loc.stripThinkTags}</div>
          </span>
        </label>
      </div>
    </div>
  );
}
