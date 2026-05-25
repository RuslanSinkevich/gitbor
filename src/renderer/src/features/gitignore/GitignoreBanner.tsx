import { useEffect, useRef, useState } from 'react';
import { t } from '../../i18n';
import { postCommand, onMainEvent } from '../../api';
import s from './GitignoreBanner.module.css';

interface Props {
  repoPath: string;
  onOpenDialog: () => void;
}

const DISMISS_KEY_PREFIX = 'sg-gitignore-banner-dismissed:';

function dismissKey(repoPath: string): string {
  return DISMISS_KEY_PREFIX + repoPath;
}

/**
 * Баннер «нет .gitignore» в панели Changes.
 *
 * Логика:
 * - На смену `repoPath` дёргаем `getGitignore` и слушаем ответ.
 * - Показываем только если `exists: false` И юзер не закрыл баннер
 *   для этого репо в текущей сессии (sessionStorage — забываем при перезапуске).
 * - После Add модалка пишет файл → ChangesView перерендерится с новыми
 *   статусами; здесь мы повторно дёргаем getGitignore по `repoPath` deps
 *   и видим exists:true → баннер скрывается автоматически.
 *
 * Состояние «открыта ли модалка» лежит выше (useDialogs), баннер только
 * триггерит её через onOpenDialog.
 */
export function GitignoreBanner({ repoPath, onOpenDialog }: Props) {
  const loc = t();
  const [missing, setMissing] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  // Ловим только последний запрос: если репо переключилось,
  // ответ от старого запроса не должен мигать баннером.
  const pendingPathRef = useRef<string>('');

  useEffect(() => {
    if (!repoPath) {
      setMissing(false);
      setDismissed(false);
      pendingPathRef.current = '';
      return;
    }

    const isDismissed = sessionStorage.getItem(dismissKey(repoPath)) === '1';
    setDismissed(isDismissed);
    pendingPathRef.current = repoPath;
    setMissing(false);

    const off = onMainEvent((msg) => {
      if (msg.type === 'gitignoreContent' && pendingPathRef.current === repoPath) {
        setMissing(!msg.exists);
      }
    });

    postCommand({ type: 'getGitignore' });
    return off;
  }, [repoPath]);

  const handleDismiss = () => {
    sessionStorage.setItem(dismissKey(repoPath), '1');
    setDismissed(true);
  };

  if (!missing || dismissed) return null;

  return (
    <div className={s.banner} role="status">
      <div className={s.text}>
        <div className={s.title}>{loc.gitignore.bannerTitle}</div>
        <div className={s.hint}>{loc.gitignore.bannerHint}</div>
      </div>
      <div className={s.actions}>
        <button
          type="button"
          className="sg-button sg-button--sm sg-button--primary"
          onClick={onOpenDialog}
        >
          {loc.gitignore.bannerAction}
        </button>
        <button
          type="button"
          className={s.dismiss}
          onClick={handleDismiss}
          aria-label={loc.gitignore.bannerDismiss}
          title={loc.gitignore.bannerDismiss}
        >
          ×
        </button>
      </div>
    </div>
  );
}
