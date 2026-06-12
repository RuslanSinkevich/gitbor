import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { postCommand, onMainEvent } from '../../api';
import { t, tpl } from '../../i18n';
import type {
  AiConnectionMode,
  AiFeatureId,
  AiProviderConfig,
  AiResponseLanguage,
  MainEvent,
  PromptId,
} from '../../types';
import type { AiDebugSnapshot } from '@core/ai/types';
import { DEFAULT_PROMPTS } from '@core/ai/prompts';
import { SgDialog } from '../../ui/SgDialog';
import {
  ConnectionSection,
  PromptsSection,
  FeaturesSection,
  BehaviorSection,
  PrivacySection,
  DebugSection,
} from './sections';
import { type AiPreset } from './presets';
import s from './AiSettingsDialog.module.css';

interface Props {
  onClose: () => void;
}

type TabId = 'connection' | 'prompts' | 'features' | 'behavior' | 'privacy' | 'debug';
type TestState = { status: 'idle' | 'testing' | 'ok' | 'fail'; error?: string };

const TABS: Array<{ id: TabId; labelKey: 'sectionConnection' | 'sectionPrompts' | 'sectionFeatures' | 'sectionBehavior' | 'sectionPrivacy' | 'sectionDebug' }> = [
  { id: 'connection', labelKey: 'sectionConnection' },
  { id: 'prompts',    labelKey: 'sectionPrompts'    },
  { id: 'features',   labelKey: 'sectionFeatures'   },
  { id: 'behavior',   labelKey: 'sectionBehavior'   },
  { id: 'privacy',    labelKey: 'sectionPrivacy'    },
  { id: 'debug',      labelKey: 'sectionDebug'      },
];

/**
 * AI Settings — диалог с табами слева. Каждая секция изолирована в
 * `./sections/*` файле, родитель собирает payload и пушит в main через
 * один общий `aiSetConfig`.
 *
 * State модель:
 *  - локальный state на каждое поле (mode, baseUrl, model, prompts,
 *    features, modelOverrides, aiEnabled, allowCloudCodeShare, ...);
 *  - `initial` хранит то, что прислал main, нужен для кнопки «Сбросить»;
 *  - `buildPayload()` собирает текущий AiProviderConfig из локального
 *    state в форме, ожидаемой `aiSetConfig`/`aiTestConnection`.
 *
 * Dirty-флаг и confirm-на-смене-таба специально НЕ добавляем: текущий
 * UX — явный «Save», переключение между табами без сохранения должно
 * быть бесшовным (это редактор настроек, а не форма ввода данных).
 */
export function AiSettingsDialog({ onClose }: Props) {
  const loc = t().ai;

  const [activeTab, setActiveTab] = useState<TabId>('connection');

  const [mode, setMode] = useState<AiConnectionMode>('openai-compatible');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [qwenWebToken, setQwenWebToken] = useState('');
  const [qwenWebCookie, setQwenWebCookie] = useState('');
  const [model, setModel] = useState('');

  const [responseLanguage, setResponseLanguage] = useState<AiResponseLanguage>('auto');
  const [prompts, setPrompts] = useState<AiProviderConfig['prompts']>({});
  const [features, setFeatures] = useState<AiProviderConfig['features']>({ commitMessage: true });
  const [modelOverrides, setModelOverrides] = useState<AiProviderConfig['modelOverrides']>({});
  const [aiEnabled, setAiEnabled] = useState(true);
  const [allowCloudCodeShare, setAllowCloudCodeShare] = useState(false);

  const [systemInUser, setSystemInUser] = useState(false);
  const [qwenDisableThinking, setQwenDisableThinking] = useState(false);
  const [stripThinkTags, setStripThinkTags] = useState(false);
  const [debugLogging, setDebugLogging] = useState(false);

  const [initial, setInitial] = useState<AiProviderConfig | null>(null);
  const [test, setTest] = useState<TestState>({ status: 'idle' });
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout>>();

  const [debugSnapshot, setDebugSnapshot] = useState<AiDebugSnapshot | null>(null);
  const [debugBusy, setDebugBusy] = useState(false);

  const buildPayload = useCallback((): AiProviderConfig => {
    const common = {
      model: model.trim(),
      aiResponseLanguage: responseLanguage,
      prompts: Object.keys(prompts ?? {}).length > 0 ? prompts : undefined,
      features,
      modelOverrides: Object.keys(modelOverrides ?? {}).length > 0 ? modelOverrides : undefined,
      aiEnabled,
      allowCloudCodeShare,
      debugLogging: debugLogging || undefined,
    } as const;

    if (mode === 'qwen-web') {
      return {
        mode: 'qwen-web',
        baseUrl: 'https://chat.qwen.ai',
        apiKey: '',
        qwenWebToken,
        qwenWebCookie: qwenWebCookie.trim() || undefined,
        ...common,
      };
    }
    return {
      mode: 'openai-compatible',
      baseUrl: baseUrl.trim(),
      apiKey,
      systemInUser: systemInUser || undefined,
      qwenDisableThinking: qwenDisableThinking || undefined,
      stripThinkTags: stripThinkTags || undefined,
      ...common,
    };
  }, [
    mode, baseUrl, apiKey, qwenWebToken, qwenWebCookie, model,
    responseLanguage, prompts, features, modelOverrides,
    aiEnabled, allowCloudCodeShare,
    systemInUser, qwenDisableThinking, stripThinkTags, debugLogging,
  ]);

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
        setQwenWebCookie(msg.config?.qwenWebCookie ?? '');
        setModel(msg.config?.model ?? '');
        setResponseLanguage(msg.config?.aiResponseLanguage ?? msg.config?.commitLanguage ?? 'auto');
        setPrompts(msg.config?.prompts ?? {});
        setFeatures(msg.config?.features ?? { commitMessage: true });
        setModelOverrides(msg.config?.modelOverrides ?? {});
        setAiEnabled(msg.config?.aiEnabled !== false);
        setAllowCloudCodeShare(msg.config?.allowCloudCodeShare === true);
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

  const handleApplyPreset = useCallback((preset: AiPreset | null) => {
    if (!preset) {
      setMode('openai-compatible');
      setBaseUrl('');
      setModel('');
      setApiKey('');
      setQwenWebToken('');
      setQwenWebCookie('');
      setSystemInUser(false);
      setQwenDisableThinking(false);
      setStripThinkTags(false);
      setTest({ status: 'idle' });
      return;
    }
    setMode(preset.mode);
    if (preset.mode === 'qwen-web') {
      setBaseUrl('');
      setModel(preset.model);
      setApiKey('');
      setQwenWebToken('');
      setQwenWebCookie('');
    } else {
      setBaseUrl(preset.baseUrl);
      setModel(preset.model);
      setQwenWebToken('');
      setQwenWebCookie('');
      if (!preset.needsKey) setApiKey('');
    }
    setSystemInUser(preset.defaults?.systemInUser === true);
    setQwenDisableThinking(preset.defaults?.qwenDisableThinking === true);
    setStripThinkTags(preset.defaults?.stripThinkTags === true);
    setTest({ status: 'idle' });
  }, []);

  const canSave =
    model.trim().length > 0 &&
    (mode === 'qwen-web' ? qwenWebToken.trim().length > 0 : baseUrl.trim().length > 0);

  const handleTest = useCallback(() => {
    if (!canSave) return;
    setTest({ status: 'testing' });
    postCommand({ type: 'aiTestConnection', config: buildPayload() });
  }, [canSave, buildPayload]);

  const handleSave = useCallback(() => {
    if (!canSave) return;
    postCommand({ type: 'aiSetConfig', config: buildPayload() });
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
    setQwenWebCookie('');
    setModel('');
    setResponseLanguage('auto');
    setPrompts({});
    setFeatures({ commitMessage: true });
    setModelOverrides({});
    setAiEnabled(true);
    setAllowCloudCodeShare(false);
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

  const handlePromptChange = useCallback((id: PromptId, value: string) => {
    setPrompts((prev) => ({ ...(prev ?? {}), [id]: value }));
  }, []);
  const handlePromptReset = useCallback((id: PromptId) => {
    setPrompts((prev) => {
      const next = { ...(prev ?? {}) };
      delete next[id];
      return next;
    });
  }, []);

  const handleFeatureToggle = useCallback((id: AiFeatureId, value: boolean) => {
    setFeatures((prev) => ({ ...(prev ?? {}), [id]: value }));
  }, []);
  const handleFeatureModelOverride = useCallback((id: AiFeatureId, value: string) => {
    setModelOverrides((prev) => {
      const next = { ...(prev ?? {}) };
      if (value.trim().length === 0) delete next[id];
      else next[id] = value;
      return next;
    });
  }, []);

  const activeContent = useMemo(() => {
    switch (activeTab) {
      case 'connection':
        return (
          <ConnectionSection
            mode={mode}
            baseUrl={baseUrl}
            apiKey={apiKey}
            qwenWebToken={qwenWebToken}
            qwenWebCookie={qwenWebCookie}
            model={model}
            systemInUser={systemInUser}
            stripThinkTags={stripThinkTags}
            qwenDisableThinking={qwenDisableThinking}
            debugLogging={debugLogging}
            allowCloudCodeShare={allowCloudCodeShare}
            onApplyPreset={handleApplyPreset}
            onModeChange={setMode}
            onBaseUrlChange={(v) => { setBaseUrl(v); setTest({ status: 'idle' }); }}
            onApiKeyChange={(v) => { setApiKey(v); setTest({ status: 'idle' }); }}
            onQwenWebTokenChange={(v) => { setQwenWebToken(v); setTest({ status: 'idle' }); }}
            onQwenWebCookieChange={(v) => { setQwenWebCookie(v); setTest({ status: 'idle' }); }}
            onModelChange={(v) => { setModel(v); setTest({ status: 'idle' }); }}
            onTest={handleTest}
            testLabel={loc.test}
          />
        );
      case 'prompts':
        return (
          <PromptsSection
            prompts={{ ...DEFAULT_PROMPTS, ...(prompts ?? {}) }}
            onChange={handlePromptChange}
            onReset={handlePromptReset}
          />
        );
      case 'features':
        return (
          <FeaturesSection
            features={features}
            modelOverrides={modelOverrides}
            onToggle={handleFeatureToggle}
            onModelOverride={handleFeatureModelOverride}
          />
        );
      case 'behavior':
        return (
          <BehaviorSection
            responseLanguage={responseLanguage}
            systemInUser={systemInUser}
            qwenDisableThinking={qwenDisableThinking}
            stripThinkTags={stripThinkTags}
            onResponseLanguageChange={setResponseLanguage}
            onSystemInUserChange={setSystemInUser}
            onQwenDisableThinkingChange={setQwenDisableThinking}
            onStripThinkTagsChange={setStripThinkTags}
          />
        );
      case 'privacy':
        return (
          <PrivacySection
            aiEnabled={aiEnabled}
            allowCloudCodeShare={allowCloudCodeShare}
            onAiEnabledChange={setAiEnabled}
            onAllowCloudCodeShareChange={setAllowCloudCodeShare}
          />
        );
      case 'debug':
        return (
          <DebugSection
            debugLogging={debugLogging}
            busy={debugBusy}
            snapshot={debugSnapshot}
            testStatus={test.status}
            testError={test.error}
            onDebugLoggingChange={setDebugLogging}
            onTestPrompt={handleTestPrompt}
            onShowLast={handleShowLast}
          />
        );
    }
  }, [
    activeTab, mode, baseUrl, apiKey, qwenWebToken, qwenWebCookie, model,
    systemInUser, stripThinkTags, qwenDisableThinking, debugLogging,
    allowCloudCodeShare, prompts, features, modelOverrides,
    responseLanguage, aiEnabled, debugBusy, debugSnapshot, test,
    handleApplyPreset, handleTest, loc.test,
    handlePromptChange, handlePromptReset,
    handleFeatureToggle, handleFeatureModelOverride,
    handleTestPrompt, handleShowLast,
  ]);

  return (
    <SgDialog
      open
      title={loc.title}
      onClose={onClose}
      size="xl"
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
      <div className={s.tabsLayout}>
        <nav className={s.tabsRail} aria-label={loc.title}>
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={activeTab === t.id ? s.tabActive : ''}
              onClick={() => setActiveTab(t.id)}
            >
              {loc[t.labelKey]}
            </button>
          ))}
        </nav>
        <div>
          {test.status === 'testing' && activeTab === 'connection' && (
            <div className={s.statusInfo}>{loc.testing}</div>
          )}
          {test.status === 'ok' && activeTab === 'connection' && (
            <div className={s.statusOk}>{loc.testOk}</div>
          )}
          {test.status === 'fail' && activeTab === 'connection' && (
            <div className={s.statusFail}>{tpl(loc.testFailed, { error: test.error ?? '' })}</div>
          )}
          {activeContent}
        </div>
      </div>
    </SgDialog>
  );
}
