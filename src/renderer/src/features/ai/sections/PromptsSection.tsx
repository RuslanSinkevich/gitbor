import { useCallback } from 'react';
import { DEFAULT_PROMPTS } from '@core/ai/prompts';
import type { AiProviderConfig, PromptId } from '../../../types';
import { t } from '../../../i18n';
import s from '../AiSettingsDialog.module.css';

interface Props {
  prompts: Partial<Record<PromptId, string>>;
  /** Список фич — для бейджа «coming soon» на ещё-не-готовых промптах. */
  features: AiProviderConfig['features'];
  onChange: (id: PromptId, value: string) => void;
  onReset: (id: PromptId) => void;
}

/**
 * Раздел «Промпты»: textarea на каждый PromptId. На этапе AI Settings
 * Redesign реально работает только `commitMessage` (остальные имеют
 * TODO-плейсхолдеры в DEFAULT_PROMPTS и не вызываются из AiService).
 * Чтобы UI был «честным», для незакоммиченных фич рисуем бейдж
 * «coming soon» и textarea остаётся редактируемой (вдруг пользователь
 * хочет заранее подготовить промпт).
 */
export function PromptsSection({ prompts, features, onChange, onReset }: Props) {
  const loc = t().ai;
  const items: Array<{ id: PromptId; titleKey: 'featureCommitMessage' | 'featureExplainCommit' | 'featureStashName' | 'featureExplainReflog' | 'featureAnalyzeConflict'; implemented: boolean }> = [
    { id: 'commitMessage',    titleKey: 'featureCommitMessage',    implemented: true  },
    { id: 'explainCommit',    titleKey: 'featureExplainCommit',    implemented: features?.explainCommit === true },
    { id: 'stashName',        titleKey: 'featureStashName',        implemented: features?.stashName === true },
    { id: 'explainReflog',    titleKey: 'featureExplainReflog',    implemented: features?.explainReflog === true },
    { id: 'analyzeConflict',  titleKey: 'featureAnalyzeConflict',  implemented: features?.analyzeConflict === true },
  ];

  return (
    <div className={s.section}>
      <p className={s.subtitle}>{loc.promptsHint}</p>
      {items.map((it) => (
        <PromptItem
          key={it.id}
          id={it.id}
          title={loc[it.titleKey]}
          comingSoon={!it.implemented}
          comingSoonLabel={loc.promptComingSoon}
          resetLabel={loc.promptResetDefault}
          value={prompts[it.id] ?? DEFAULT_PROMPTS[it.id]}
          onChange={onChange}
          onReset={onReset}
        />
      ))}
    </div>
  );
}

interface ItemProps {
  id: PromptId;
  title: string;
  comingSoon: boolean;
  comingSoonLabel: string;
  resetLabel: string;
  value: string;
  onChange: (id: PromptId, value: string) => void;
  onReset: (id: PromptId) => void;
}

function PromptItem({ id, title, comingSoon, comingSoonLabel, resetLabel, value, onChange, onReset }: ItemProps) {
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => onChange(id, e.target.value),
    [id, onChange],
  );
  const handleReset = useCallback(() => onReset(id), [id, onReset]);

  return (
    <div className={s.field}>
      <div className={s.promptHeader}>
        <span className={s.label}>{title}</span>
        {comingSoon && <span className={s.badge}>{comingSoonLabel}</span>}
        <button
          type="button"
          className="sg-button sg-button--ghost sg-button--sm"
          onClick={handleReset}
        >
          {resetLabel}
        </button>
      </div>
      <textarea
        className="sg-input"
        rows={8}
        value={value}
        onChange={handleChange}
        spellCheck={false}
        style={{ fontFamily: 'var(--sg-font-mono)', fontSize: 12, resize: 'vertical', minHeight: 140 }}
      />
    </div>
  );
}
