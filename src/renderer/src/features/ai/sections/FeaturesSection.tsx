import { useCallback } from 'react';
import type { AiFeatureId } from '@core/ai/types';
import type { AiProviderConfig } from '../../../types';
import { t } from '../../../i18n';
import s from '../AiSettingsDialog.module.css';

interface Props {
  features: AiProviderConfig['features'];
  modelOverrides: AiProviderConfig['modelOverrides'];
  onToggle: (id: AiFeatureId, value: boolean) => void;
  onModelOverride: (id: AiFeatureId, value: string) => void;
}

interface Row {
  id: AiFeatureId;
  titleKey: 'featureCommitMessage' | 'featureExplainCommit' | 'featureStashName' | 'featureExplainReflog' | 'featureAnalyzeConflict' | 'featureSemanticSearch';
  implemented: boolean;
}

const ROWS: Row[] = [
  { id: 'commitMessage',   titleKey: 'featureCommitMessage',   implemented: true  },
  /* Tier-2 фичи — на этапе AI Settings Redesign только toggle-плейсхолдер;
     реальная реализация (методы AiService, IPC, UI кнопки) лежит на
     этапе ai-tier2-features-todo.md. */
  { id: 'explainCommit',   titleKey: 'featureExplainCommit',   implemented: false },
  { id: 'stashName',       titleKey: 'featureStashName',       implemented: false },
  { id: 'explainReflog',   titleKey: 'featureExplainReflog',   implemented: false },
  { id: 'analyzeConflict', titleKey: 'featureAnalyzeConflict', implemented: false },
  { id: 'semanticSearch',  titleKey: 'featureSemanticSearch',  implemented: false },
];

/**
 * Раздел «Возможности»: per-feature toggle + опциональный model-override.
 * Чекбокс выключенной/незакоммиченной фичи остаётся кликабельным — юзер
 * может заранее включить её, чтобы он сработал когда фича прилетит в
 * билд. AiService всё равно проверит features[id] при попытке вызова.
 */
export function FeaturesSection({ features, modelOverrides, onToggle, onModelOverride }: Props) {
  const loc = t().ai;
  return (
    <div className={s.section}>
      <p className={s.subtitle}>{loc.featuresHint}</p>
      {ROWS.map((row) => (
        <FeatureRow
          key={row.id}
          id={row.id}
          title={loc[row.titleKey]}
          comingSoon={!row.implemented}
          comingSoonLabel={loc.promptComingSoon}
          overrideLabel={loc.featureModelOverride}
          overridePlaceholder={loc.featureModelOverridePlaceholder}
          enabled={features?.[row.id] === true}
          modelOverride={modelOverrides?.[row.id] ?? ''}
          onToggle={onToggle}
          onModelOverride={onModelOverride}
        />
      ))}
    </div>
  );
}

interface RowProps {
  id: AiFeatureId;
  title: string;
  comingSoon: boolean;
  comingSoonLabel: string;
  overrideLabel: string;
  overridePlaceholder: string;
  enabled: boolean;
  modelOverride: string;
  onToggle: (id: AiFeatureId, value: boolean) => void;
  onModelOverride: (id: AiFeatureId, value: string) => void;
}

function FeatureRow({
  id, title, comingSoon, comingSoonLabel,
  overrideLabel, overridePlaceholder,
  enabled, modelOverride, onToggle, onModelOverride,
}: RowProps) {
  const handleToggle = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => onToggle(id, e.target.checked),
    [id, onToggle],
  );
  const handleOverride = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => onModelOverride(id, e.target.value),
    [id, onModelOverride],
  );
  return (
    <div className={s.field}>
      <label className={s.checkLine}>
        <input type="checkbox" checked={enabled} onChange={handleToggle} aria-label={title} />
        <span>
          <div className={s.promptHeader}>
            <span>{title}</span>
            {comingSoon && <span className={s.badge}>{comingSoonLabel}</span>}
          </div>
        </span>
      </label>
      <label className={s.field} style={{ marginLeft: 28, marginTop: 4 }}>
        <span className={s.label}>{overrideLabel}</span>
        <input
          className="sg-input"
          value={modelOverride}
          placeholder={overridePlaceholder}
          onChange={handleOverride}
          spellCheck={false}
        />
      </label>
    </div>
  );
}
