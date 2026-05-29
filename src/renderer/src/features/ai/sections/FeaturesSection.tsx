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

type TitleKey =
  | 'featureCommitMessage'
  | 'featureExplainCommit'
  | 'featureStashName'
  | 'featureExplainReflog'
  | 'featureAnalyzeConflict'
  | 'featureSemanticSearch';

interface Row {
  id: AiFeatureId;
  titleKey: TitleKey;
}

const ROWS: Row[] = [
  { id: 'commitMessage',   titleKey: 'featureCommitMessage'   },
  { id: 'explainCommit',   titleKey: 'featureExplainCommit'   },
  { id: 'stashName',       titleKey: 'featureStashName'       },
  { id: 'explainReflog',   titleKey: 'featureExplainReflog'   },
  { id: 'analyzeConflict', titleKey: 'featureAnalyzeConflict' },
  { id: 'semanticSearch',  titleKey: 'featureSemanticSearch'  },
];

/**
 * Раздел «Возможности»: per-feature toggle + опциональный model-override.
 * AiService/AiHandlers проверяют features[id] при вызове, выключенные фичи
 * просто не доступны из UI-точек интеграции.
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
  overrideLabel: string;
  overridePlaceholder: string;
  enabled: boolean;
  modelOverride: string;
  onToggle: (id: AiFeatureId, value: boolean) => void;
  onModelOverride: (id: AiFeatureId, value: string) => void;
}

function FeatureRow({
  id, title,
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
