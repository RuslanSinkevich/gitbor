import { useCallback, useMemo } from 'react';
import type { AiConnectionMode } from '../../../types';
import { QWEN_WEB_DEFAULT_MODEL_ID, QWEN_WEB_MODEL_IDS, isQwenWebModelId } from '@core/ai/qwenWebModels';
import { t } from '../../../i18n';
import {
  AI_PRESETS,
  detectPreset,
  getPresetsByGroup,
  isForeignByConnection,
  type AiPreset,
  type AiPresetGroup,
} from '../presets';
import s from '../AiSettingsDialog.module.css';

interface Props {
  mode: AiConnectionMode;
  baseUrl: string;
  apiKey: string;
  qwenWebToken: string;
  qwenWebCookie: string;
  model: string;
  systemInUser: boolean;
  stripThinkTags: boolean;
  qwenDisableThinking: boolean;
  debugLogging: boolean;
  allowCloudCodeShare: boolean;
  /**
   * Применить пресет: меняет mode/baseUrl/model/apiKey и opt-in флаги
   * совместимости. Родитель сам решает что сохранять (см. Dialog).
   */
  onApplyPreset: (preset: AiPreset | null) => void;
  onModeChange: (mode: AiConnectionMode) => void;
  onBaseUrlChange: (v: string) => void;
  onApiKeyChange: (v: string) => void;
  onQwenWebTokenChange: (v: string) => void;
  onQwenWebCookieChange: (v: string) => void;
  onModelChange: (v: string) => void;
  /** Послать `aiTestConnection` с текущим payload — состояние крутилки/результата живёт в Dialog. */
  onTest: () => void;
  testLabel: string;
}

const PRESET_GROUP_LABELS: Record<AiPresetGroup, keyof ReturnType<typeof t>['ai']> = {
  local: 'presetGroupLocal',
  corporate: 'presetGroupCorporate',
  'no-vpn': 'presetGroupNoVpn',
  russian: 'presetGroupRussian',
  foreign: 'presetGroupForeign',
};

/**
 * Раздел «Подключение»: пресет, baseUrl, apiKey, qwenWebToken, model,
 * Test connection. Дополнительные галки (system-in-user, strip-think,
 * qwen-disable-thinking) живут в `BehaviorSection`, но мы прокидываем
 * детектор пресета через них (qwen-corporate определяется по systemInUser
 * + stripThinkTags).
 */
export function ConnectionSection(props: Props) {
  const loc = t().ai;
  const grouped = useMemo(() => getPresetsByGroup(), []);
  const presetId = useMemo(
    () => detectPreset(props.mode, props.baseUrl, {
      systemInUser: props.systemInUser,
      stripThinkTags: props.stripThinkTags,
    }),
    [props.mode, props.baseUrl, props.systemInUser, props.stripThinkTags],
  );

  const handlePreset = useCallback((id: string) => {
    if (id === 'custom') { props.onApplyPreset(null); return; }
    const preset = AI_PRESETS.find((p) => p.id === id) ?? null;
    props.onApplyPreset(preset);
  }, [props]);

  const showCloudWarning = !props.allowCloudCodeShare && isForeignByConnection(props.mode, props.baseUrl);

  return (
    <div className={s.section}>
      <label className={s.field}>
        <span className={s.label}>{loc.presets}</span>
        <select
          className="sg-select"
          value={presetId}
          onChange={(e) => handlePreset(e.target.value)}
        >
          {renderGroup(grouped.local, PRESET_GROUP_LABELS.local, loc)}
          {renderGroup(grouped.corporate, PRESET_GROUP_LABELS.corporate, loc)}
          {renderGroup(grouped['no-vpn'], PRESET_GROUP_LABELS['no-vpn'], loc)}
          {renderGroup(grouped.russian, PRESET_GROUP_LABELS.russian, loc)}
          {renderGroup(grouped.foreign, PRESET_GROUP_LABELS.foreign, loc)}
          <option value="custom">{loc.presetCustom}</option>
        </select>
      </label>

      {props.mode === 'openai-compatible' ? (
        <>
          <label className={s.field}>
            <span className={s.label}>{loc.baseUrl}</span>
            <input
              className="sg-input"
              value={props.baseUrl}
              onChange={(e) => props.onBaseUrlChange(e.target.value)}
              placeholder="https://api.openai.com/v1"
              spellCheck={false}
            />
            <span className={s.hint}>{loc.baseUrlHint}</span>
          </label>

          <label className={s.field}>
            <span className={s.label}>{loc.apiKey}</span>
            <input
              className="sg-input"
              type="password"
              value={props.apiKey}
              onChange={(e) => props.onApiKeyChange(e.target.value)}
              placeholder="sk-..."
              autoComplete="off"
              spellCheck={false}
            />
            <span className={s.hint}>{loc.apiKeyHint}</span>
          </label>

          <label className={s.field}>
            <span className={s.label}>{loc.model}</span>
            <input
              className="sg-input"
              value={props.model}
              onChange={(e) => props.onModelChange(e.target.value)}
              placeholder="gpt-4o-mini"
              spellCheck={false}
            />
            <span className={s.hint}>{loc.modelHint}</span>
          </label>
        </>
      ) : (
        <>
          <label className={s.field}>
            <span className={s.label}>{loc.qwenWebUrl}</span>
            <input
              className="sg-input"
              value="https://chat.qwen.ai"
              readOnly
              spellCheck={false}
            />
            <span className={s.hint}>{loc.qwenWebUrlHint}</span>
          </label>

          <label className={s.field}>
            <span className={s.label}>{loc.qwenWebToken}</span>
            <input
              className="sg-input"
              type="password"
              value={props.qwenWebToken}
              onChange={(e) => props.onQwenWebTokenChange(e.target.value)}
              placeholder={loc.qwenWebTokenPlaceholder}
              autoComplete="off"
              spellCheck={false}
            />
            <span className={s.hint}>{loc.qwenWebTokenHint}</span>
          </label>

          <label className={s.field}>
            <span className={s.label}>{loc.qwenWebCookie}</span>
            <input
              className="sg-input"
              type="password"
              value={props.qwenWebCookie}
              onChange={(e) => props.onQwenWebCookieChange(e.target.value)}
              placeholder={loc.qwenWebCookiePlaceholder}
              autoComplete="off"
              spellCheck={false}
            />
            <span className={s.hint}>{loc.qwenWebCookieHint}</span>
          </label>

          <p className={s.hint}>{loc.qwenWebHowto}</p>
          <a
            className={s.externalLink}
            href="https://chat.qwen.ai"
            target="_blank"
            rel="noreferrer"
          >
            {loc.qwenWebOpenChat}
          </a>

          <label className={s.field}>
            <span className={s.label}>{loc.model}</span>
            <select
              className="sg-select"
              value={isQwenWebModelId(props.model) ? props.model : QWEN_WEB_DEFAULT_MODEL_ID}
              onChange={(e) => props.onModelChange(e.target.value)}
            >
              {QWEN_WEB_MODEL_IDS.map((id) => (
                <option key={id} value={id}>{id}</option>
              ))}
            </select>
            <span className={s.hint}>{loc.qwenWebModelHint}</span>
          </label>
        </>
      )}

      {showCloudWarning && (
        <div className={s.warn}>{loc.cloudShareBlocked}</div>
      )}

      <div className={s.field}>
        <button
          className="sg-button sg-button--ghost sg-button--sm"
          onClick={props.onTest}
          type="button"
        >
          {props.testLabel}
        </button>
      </div>
    </div>
  );
}

function renderGroup(items: AiPreset[], labelKey: keyof ReturnType<typeof t>['ai'], loc: ReturnType<typeof t>['ai']) {
  if (items.length === 0) return null;
  return (
    <optgroup key={labelKey} label={String(loc[labelKey])}>
      {items.map((p) => (
        <option key={p.id} value={p.id}>{String(loc[p.labelKey])}</option>
      ))}
    </optgroup>
  );
}
