import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { postCommand, onMainEvent } from '../../api';
import { t, tpl } from '../../i18n';
import type { AiConnectionMode, AiProviderConfig, CommitLanguage, MainEvent } from '../../types';
import type { AiDebugSnapshot } from '@core/ai/types';
import { QWEN_WEB_DEFAULT_MODEL_ID, QWEN_WEB_MODEL_IDS, isQwenWebModelId } from '@core/ai/qwenWebModels';
import { SgDialog } from '../../ui/SgDialog';
import { AI_PRESETS, detectPreset } from './presets';
import s from './AiSettingsDialog.module.css';

interface Props {
  onClose: () => void;
}

type TestState = { status: 'idle' | 'testing' | 'ok' | 'fail'; error?: string };

const PRESET_GROUPS = {
  cloud: ['openai', 'deepseek', 'groq'],
  local: ['ollama', 'lmstudio'],
  web: ['qwen-web'],
  corporate: ['qwen-corporate'],
} as const;

export function AiSettingsDialog({ onClose }: Props) {
  const loc = t().ai;
  const [mode, setMode] = useState<AiConnectionMode>('openai-compatible');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [qwenWebToken, setQwenWebToken] = useState('');
  const [model, setModel] = useState('');
  const [commitLanguage, setCommitLanguage] = useState<CommitLanguage>('auto');
  const [initial, setInitial] = useState<AiProviderConfig | null>(null);
  const [test, setTest] = useState<TestState>({ status: 'idle' });
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout>>();

  const [systemInUser, setSystemInUser] = useState(false);
  const [qwenDisableThinking, setQwenDisableThinking] = useState(false);
  const [stripThinkTags, setStripThinkTags] = useState(false);
  const [debugLogging, setDebugLogging] = useState(false);

  const [debugSnapshot, setDebugSnapshot] = useState<AiDebugSnapshot | null>(null);
  const [debugBusy, setDebugBusy] = useState(false);

  const presetId = useMemo(
    () => detectPreset(mode, baseUrl, model, { systemInUser, stripThinkTags }),
    [mode, baseUrl, model, systemInUser, stripThinkTags],
  );

  const buildPayload = useCallback((): AiProviderConfig => {
    if (mode === 'qwen-web') {
      return {
        mode: 'qwen-web',
        baseUrl: 'https://chat.qwen.ai',
        apiKey: '',
        qwenWebToken,
        model: model.trim(),
        commitLanguage,
        debugLogging,
      };
    }
    return {
      mode: 'openai-compatible',
      baseUrl: baseUrl.trim(),
      apiKey,
      model: model.trim(),
      commitLanguage,
      systemInUser: systemInUser || undefined,
      qwenDisableThinking: qwenDisableThinking || undefined,
      stripThinkTags: stripThinkTags || undefined,
      debugLogging: debugLogging || undefined,
    };
  }, [mode, baseUrl, apiKey, qwenWebToken, model, commitLanguage,
      systemInUser, qwenDisableThinking, stripThinkTags, debugLogging]);

  useEffect(() => {
    postCommand({ type: 'aiGetConfig' });
    const unsub = onMainEvent((msg: MainEvent) => {
      if (msg.type === 'aiConfig') {
        setInitial(msg.config);
        const m = msg.config?.mode ?? 'openai-compatible';
        setMode(m);
        setBaseUrl(msg.config?.baseUrl ?? '');
        setApiKey(msg.config?.apiKey ?? '');
        setQwenWebToken(msg.config?.qwenWebToken ?? '');
        setModel(msg.config?.model ?? '');
        setCommitLanguage(msg.config?.commitLanguage ?? 'auto');
        setSystemInUser(msg.config?.systemInUser === true);
        setQwenDisableThinking(msg.config?.qwenDisableThinking === true);
        setStripThinkTags(msg.config?.stripThinkTags === true);
        setDebugLogging(msg.config?.debugLogging === true);
      } else if (msg.type === 'aiTestResult') {
        setTest(msg.success ? { status: 'ok' } : { status: 'fail', error: msg.error });
      } else if (msg.type === 'aiTestPromptResult') {
        setDebugBusy(false);
        setDebugSnapshot(msg.snapshot);
        if (!msg.success) {
          setTest({ status: 'fail', error: msg.error });
        }
      } else if (msg.type === 'aiLastDebug') {
        setDebugSnapshot(msg.snapshot);
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
      setMode('openai-compatible');
      setBaseUrl('');
      setModel('');
      setApiKey('');
      setQwenWebToken('');
      setSystemInUser(false);
      setQwenDisableThinking(false);
      setStripThinkTags(false);
      setTest({ status: 'idle' });
      return;
    }
    const preset = AI_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    setMode(preset.mode);
    if (preset.mode === 'qwen-web') {
      setBaseUrl('');
      setModel(preset.model);
      setApiKey('');
      setQwenWebToken('');
    } else {
      setBaseUrl(preset.baseUrl);
      setModel(preset.model);
      setQwenWebToken('');
      if (!preset.needsKey) setApiKey('');
    }
    setSystemInUser(preset.defaults?.systemInUser === true);
    setQwenDisableThinking(preset.defaults?.qwenDisableThinking === true);
    setStripThinkTags(preset.defaults?.stripThinkTags === true);
    setTest({ status: 'idle' });
  }, []);

  const canSave =
    model.trim().length > 0 &&
    (mode === 'qwen-web'
      ? qwenWebToken.trim().length > 0
      : baseUrl.trim().length > 0);

  const handleTest = useCallback(() => {
    if (!canSave) return;
    setTest({ status: 'testing' });
    postCommand({
      type: 'aiTestConnection',
      config: buildPayload(),
    });
  }, [canSave, buildPayload]);

  const handleSave = useCallback(() => {
    if (!canSave) return;
    postCommand({
      type: 'aiSetConfig',
      config: buildPayload(),
    });
    setSaved(true);
    clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), 2000);
  }, [canSave, buildPayload]);

  const handleClear = useCallback(() => {
    postCommand({ type: 'aiSetConfig', config: null });
    setMode('openai-compatible');
    setBaseUrl('');
    setApiKey('');
    setQwenWebToken('');
    setModel('');
    setCommitLanguage('auto');
    setSystemInUser(false);
    setQwenDisableThinking(false);
    setStripThinkTags(false);
    setDebugLogging(false);
    setDebugSnapshot(null);
    setInitial(null);
    setTest({ status: 'idle' });
  }, []);

  const handleTestPrompt = useCallback(() => {
    if (!canSave) return;
    setDebugBusy(true);
    setDebugSnapshot(null);
    postCommand({ type: 'aiTestPrompt', config: buildPayload() });
  }, [canSave, buildPayload]);

  const handleShowLast = useCallback(() => {
    postCommand({ type: 'aiGetLastDebug' });
  }, []);

  return (
    <SgDialog
      open
      title={loc.title}
      onClose={onClose}
      size="lg"
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, width: '100%' }}>
          <div>
            {initial && (
              <button
                className="sg-button sg-button--ghost sg-button--sm"
                onClick={handleClear}
                type="button"
              >
                {loc.clear}
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
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
      }
    >
      <p className={s.subtitle}>{loc.subtitle}</p>

      <label className={s.field}>
            <span className={s.label}>{loc.presets}</span>
            <select
              className="sg-select"
              value={presetId}
              onChange={(e) => handlePreset(e.target.value)}
            >
              <optgroup label={loc.presetGroupCloud}>
                {PRESET_GROUPS.cloud.map((id) => {
                  const p = AI_PRESETS.find((x) => x.id === id);
                  return p ? <option key={p.id} value={p.id}>{loc[p.labelKey]}</option> : null;
                })}
              </optgroup>
              <optgroup label={loc.presetGroupLocal}>
                {PRESET_GROUPS.local.map((id) => {
                  const p = AI_PRESETS.find((x) => x.id === id);
                  return p ? <option key={p.id} value={p.id}>{loc[p.labelKey]}</option> : null;
                })}
              </optgroup>
              <optgroup label={loc.presetGroupWeb}>
                {PRESET_GROUPS.web.map((id) => {
                  const p = AI_PRESETS.find((x) => x.id === id);
                  return p ? <option key={p.id} value={p.id}>{loc[p.labelKey]}</option> : null;
                })}
              </optgroup>
              <optgroup label={loc.presetGroupCorporate}>
                {PRESET_GROUPS.corporate.map((id) => {
                  const p = AI_PRESETS.find((x) => x.id === id);
                  return p ? <option key={p.id} value={p.id}>{loc[p.labelKey]}</option> : null;
                })}
              </optgroup>
              <option value="custom">{loc.presetCustom}</option>
            </select>
          </label>

          {mode === 'openai-compatible' ? (
            <>
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
                  value={qwenWebToken}
                  onChange={(e) => { setQwenWebToken(e.target.value); setTest({ status: 'idle' }); }}
                  placeholder={loc.qwenWebTokenPlaceholder}
                  autoComplete="off"
                  spellCheck={false}
                />
                <span className={s.hint}>{loc.qwenWebTokenHint}</span>
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
                  value={isQwenWebModelId(model) ? model : QWEN_WEB_DEFAULT_MODEL_ID}
                  onChange={(e) => { setModel(e.target.value); setTest({ status: 'idle' }); }}
                >
                  {QWEN_WEB_MODEL_IDS.map((id) => (
                    <option key={id} value={id}>{id}</option>
                  ))}
                </select>
                <span className={s.hint}>{loc.qwenWebModelHint}</span>
              </label>
            </>
          )}

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

          {mode === 'openai-compatible' && (
            <div className={s.field}>
              <span className={s.label}>{loc.advanced}</span>
              <label className={s.checkLine}>
                <input type="checkbox" checked={systemInUser}
                  aria-label={loc.systemInUser}
                  onChange={(e) => setSystemInUser(e.target.checked)} />
                <span>
                  <div>{loc.systemInUser}</div>
                  <div className={s.hint}>{loc.systemInUserHint}</div>
                </span>
              </label>
              <label className={s.checkLine}>
                <input type="checkbox" checked={qwenDisableThinking}
                  aria-label={loc.qwenDisableThinking}
                  onChange={(e) => setQwenDisableThinking(e.target.checked)} />
                <span>
                  <div>{loc.qwenDisableThinking}</div>
                </span>
              </label>
              <label className={s.checkLine}>
                <input type="checkbox" checked={stripThinkTags}
                  aria-label={loc.stripThinkTags}
                  onChange={(e) => setStripThinkTags(e.target.checked)} />
                <span>
                  <div>{loc.stripThinkTags}</div>
                </span>
              </label>
              <label className={s.checkLine}>
                <input type="checkbox" checked={debugLogging}
                  aria-label={loc.debugMode}
                  onChange={(e) => setDebugLogging(e.target.checked)} />
                <span>
                  <div>{loc.debugMode}</div>
                </span>
              </label>
            </div>
          )}

          {test.status === 'testing' && <div className={s.statusInfo}>{loc.testing}</div>}
          {test.status === 'ok' && <div className={s.statusOk}>{loc.testOk}</div>}
          {test.status === 'fail' && (
            <div className={s.statusFail}>{tpl(loc.testFailed, { error: test.error ?? '' })}</div>
          )}

          {mode === 'openai-compatible' && (
            <div className={s.field}>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="sg-button sg-button--ghost sg-button--sm"
                  onClick={handleTestPrompt} disabled={!canSave || debugBusy} type="button">
                  {loc.testPrompt}
                </button>
                <button className="sg-button sg-button--ghost sg-button--sm"
                  onClick={handleShowLast} type="button">
                  {loc.showLastRequest}
                </button>
              </div>
              {debugBusy && <div className={s.statusInfo}>{loc.testing}</div>}
              {debugSnapshot && (
                <pre className={s.hint} style={{
                  whiteSpace: 'pre-wrap', maxHeight: 220, overflow: 'auto',
                  border: '1px solid var(--sg-border, #ccc)', padding: 8, marginTop: 8,
                  fontFamily: 'monospace', fontSize: 11,
                }}>{JSON.stringify(debugSnapshot, null, 2)}</pre>
              )}
            </div>
          )}
    </SgDialog>
  );
}
