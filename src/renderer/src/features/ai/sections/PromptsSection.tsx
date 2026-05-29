import { useCallback } from 'react';
import { DEFAULT_PROMPTS } from '@core/ai/prompts';
import type { PromptId } from '../../../types';
import { t } from '../../../i18n';
import s from '../AiSettingsDialog.module.css';

interface Props {
  prompts: Partial<Record<PromptId, string>>;
  onChange: (id: PromptId, value: string) => void;
  onReset: (id: PromptId) => void;
}

type TitleKey =
  | 'featureCommitMessage'
  | 'featureExplainCommit'
  | 'featureStashName'
  | 'featureExplainReflog'
  | 'featureAnalyzeConflict';

const ITEMS: Array<{ id: PromptId; titleKey: TitleKey }> = [
  { id: 'commitMessage',   titleKey: 'featureCommitMessage'   },
  { id: 'explainCommit',   titleKey: 'featureExplainCommit'   },
  { id: 'stashName',       titleKey: 'featureStashName'       },
  { id: 'explainReflog',   titleKey: 'featureExplainReflog'   },
  { id: 'analyzeConflict', titleKey: 'featureAnalyzeConflict' },
];

/**
 * Раздел «Промпты»: textarea на каждый PromptId. Все промпты реально
 * используются: commitMessage в AiService.generateCommitMessage, остальные
 * — в Tier-2 AiHandlers (runFeature/runFeatureOnce). Включение/выключение
 * управляется в табе «Возможности».
 */
export function PromptsSection({ prompts, onChange, onReset }: Props) {
  const loc = t().ai;
  return (
    <div className={s.section}>
      <p className={s.subtitle}>{loc.promptsHint}</p>
      {ITEMS.map((it) => (
        <PromptItem
          key={it.id}
          id={it.id}
          title={loc[it.titleKey]}
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
  resetLabel: string;
  value: string;
  onChange: (id: PromptId, value: string) => void;
  onReset: (id: PromptId) => void;
}

function PromptItem({ id, title, resetLabel, value, onChange, onReset }: ItemProps) {
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => onChange(id, e.target.value),
    [id, onChange],
  );
  const handleReset = useCallback(() => onReset(id), [id, onReset]);

  return (
    <div className={s.field}>
      <div className={s.promptHeader}>
        <span className={s.label}>{title}</span>
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
