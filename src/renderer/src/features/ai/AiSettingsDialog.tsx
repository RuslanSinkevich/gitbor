import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { postCommand, onMainEvent } from '../../api';
import { t, tpl } from '../../i18n';
import type { AiProviderConfig, CommitLanguage, MainEvent } from '../../types';
import { AI_PRESETS, detectPreset } from './presets';
import s from './AiSettingsDialog.module.css';

interface Props {
  onClose: () => void;
}

type TestState = { status: 'idle' | 'testing' | 'ok' | 'fail'; error?: string };

export function AiSettingsDialog({ onClose }: Props) {
  const loc = t().ai;
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [commitLanguage, setCommitLanguage] = useState<CommitLanguage>('auto');
  const [initial, setInitial] = useState<AiProviderConfig | null>(null);
  const [test, setTest] = useState<TestState>({ status: 'idle' });
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout>>();

  const presetId = useMemo(() => detectPreset(baseUrl), [baseUrl]);

  useEffect(() => {
    postCommand({ type: 'aiGetConfig' });
    const unsub = onMainEvent((msg: MainEvent) => {
      if (msg.type === 'aiConfig') {
        setInitial(msg.config);
        setBaseUrl(msg.config?.baseUrl ?? '');
        setApiKey(msg.config?.apiKey ?? '');
        setModel(msg.config?.model ?? '');
        setCommitLanguage(msg.config?.commitLanguage ?? 'auto');
      } else if (msg.type === 'aiTestResult') {
        setTest(msg.success ? { status: 'ok' } : { status: 'fail', error: msg.error });
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => () => clearTimeout(savedTimer.current), []);

  const handlePreset = useCallback((id: string) => {
    if (id === 'custom') {
      setBaseUrl('');
      setModel('');
      setApiKey('');
      setTest({ status: 'idle' });
      return;
    }
    const preset = AI_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    setBaseUrl(preset.baseUrl);
    setModel(preset.model);
    if (!preset.needsKey) setApiKey('');
    setTest({ status: 'idle' });
  }, []);

  const canSave = baseUrl.trim().length > 0 && model.trim().length > 0;

  const handleTest = useCallback(() => {
    if (!canSave) return;
    setTest({ status: 'testing' });
    postCommand({
      type: 'aiTestConnection',
      config: { baseUrl: baseUrl.trim(), apiKey, model: model.trim(), commitLanguage },
    });
  }, [canSave, baseUrl, apiKey, model, commitLanguage]);

  const handleSave = useCallback(() => {
    if (!canSave) return;
    postCommand({
      type: 'aiSetConfig',
      config: { baseUrl: baseUrl.trim(), apiKey, model: model.trim(), commitLanguage },
    });
    setSaved(true);
    clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), 2000);
  }, [canSave, baseUrl, apiKey, model, commitLanguage]);

  const handleClear = useCallback(() => {
    postCommand({ type: 'aiSetConfig', config: null });
    setBaseUrl('');
    setApiKey('');
    setModel('');
    setCommitLanguage('auto');
    setInitial(null);
    setTest({ status: 'idle' });
  }, []);

  return (
    <div className={s.overlay} onClick={onClose}>
      <div className={s.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={s.header}>
          <h2>{loc.title}</h2>
          <button className={s.closeBtn} onClick={onClose}>&times;</button>
        </div>

        <div className={s.body}>
          <p className={s.subtitle}>{loc.subtitle}</p>

          <div className={s.presets} role="tablist">
            <span className={s.presetsLabel}>{loc.presets}:</span>
            {AI_PRESETS.map((p) => (
              <button
                key={p.id}
                className={`${s.preset} ${presetId === p.id ? s.presetActive : ''}`}
                onClick={() => handlePreset(p.id)}
                type="button"
              >
                {loc[p.labelKey]}
              </button>
            ))}
            <button
              className={`${s.preset} ${presetId === 'custom' ? s.presetActive : ''}`}
              onClick={() => handlePreset('custom')}
              type="button"
            >
              {loc.presetCustom}
            </button>
          </div>

          <label className={s.field}>
            <span className={s.label}>{loc.baseUrl}</span>
            <input
              className="sg-input"
              value={baseUrl}
              onChange={(e) => { setBaseUrl(e.target.value); setTest({ status: 'idle' }); }}
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
              value={apiKey}
              onChange={(e) => { setApiKey(e.target.value); setTest({ status: 'idle' }); }}
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
              value={model}
              onChange={(e) => { setModel(e.target.value); setTest({ status: 'idle' }); }}
              placeholder="gpt-4o-mini"
              spellCheck={false}
            />
            <span className={s.hint}>{loc.modelHint}</span>
          </label>

          <label className={s.field}>
            <span className={s.label}>{loc.commitLanguage}</span>
            <select
              className="sg-select"
              value={commitLanguage}
              onChange={(e) => setCommitLanguage(e.target.value as CommitLanguage)}
            >
              <option value="auto">{loc.commitLanguageAuto}</option>
              <option value="en">{loc.commitLanguageEn}</option>
              <option value="ru">{loc.commitLanguageRu}</option>
            </select>
            <span className={s.hint}>{loc.commitLanguageHint}</span>
          </label>

          {test.status === 'testing' && <div className={s.statusInfo}>{loc.testing}</div>}
          {test.status === 'ok' && <div className={s.statusOk}>{loc.testOk}</div>}
          {test.status === 'fail' && (
            <div className={s.statusFail}>{tpl(loc.testFailed, { error: test.error ?? '' })}</div>
          )}
        </div>

        <div className={s.footer}>
          {initial && (
            <button
              className="sg-button sg-button--ghost sg-button--sm"
              onClick={handleClear}
              type="button"
            >
              {loc.clear}
            </button>
          )}
          <div className={s.footerRight}>
            <button
              className="sg-button sg-button--ghost sg-button--sm"
              onClick={handleTest}
              disabled={!canSave || test.status === 'testing'}
              type="button"
            >
              {loc.test}
            </button>
            <button
              className="sg-button sg-button--primary sg-button--sm"
              onClick={handleSave}
              disabled={!canSave}
              type="button"
            >
              {saved ? loc.saved : loc.save}
            </button>
            <button className="sg-button sg-button--ghost sg-button--sm" onClick={onClose} type="button">
              {loc.close}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
