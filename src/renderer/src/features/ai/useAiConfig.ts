import { useEffect, useState } from 'react';
import { postCommand, onMainEvent } from '../../api';
import type { AiProviderConfig, MainEvent } from '../../types';
import { AI_ENABLED } from '@core/buildFlags';

/**
 * Хук синхронизации текущего AI-конфига с main-процессом. Запрашивает
 * при монтировании, подписывается на обновления. Секреты (apiKey,
 * qwenWebToken) из main приходят замаскированными.
 */
export function useAiConfig(): {
  config: AiProviderConfig | null;
  loaded: boolean;
  refresh: () => void;
} {
  const [config, setConfig] = useState<AiProviderConfig | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!AI_ENABLED) {
      setConfig(null);
      setLoaded(true);
      return;
    }
    postCommand({ type: 'aiGetConfig' });
    const unsub = onMainEvent((msg: MainEvent) => {
      if (msg.type === 'aiConfig') {
        setConfig(msg.config);
        setLoaded(true);
      }
    });
    return unsub;
  }, []);

  const refresh = () => {
    if (AI_ENABLED) postCommand({ type: 'aiGetConfig' });
  };

  return { config, loaded, refresh };
}
