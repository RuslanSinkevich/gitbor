import { t } from '../../i18n';
import { SgDialog } from '../../ui/SgDialog';
import s from './SupportDialog.module.css';

interface Props {
  open: boolean;
  onClose: () => void;
  onDismiss: () => void;
}

const TELEGRAM_URL = 'https://t.me/ruslansinkevich';
const SITE_URL = 'https://ruslansinkevich.ru';
const EMAIL = 'ruslan-sink@mail.ru';

const IconTelegram = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M21.9 4.3 18.7 19.6c-.2 1-.9 1.3-1.7.8l-4.7-3.5-2.3 2.2c-.3.3-.5.5-1 .5l.4-5 9-8.1c.4-.3-.1-.5-.6-.2L6.4 13.6l-4.8-1.5c-1-.3-1-1 .2-1.5l18.7-7.2c.9-.3 1.6.2 1.4 1.4z" />
  </svg>
);
const IconSite = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18" />
  </svg>
);
const IconMail = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" />
  </svg>
);

export function SupportDialog({ open, onClose, onDismiss }: Props) {
  const loc = t().support;

  const footer = (
    <div className={s.footer}>
      <button type="button" className="sg-button sg-button--ghost sg-button--sm" onClick={onDismiss}>
        {loc.dontShow}
      </button>
      <button type="button" className="sg-button sg-button--primary sg-button--sm" onClick={onClose}>
        {loc.thanks}
      </button>
    </div>
  );

  return (
    <SgDialog open={open} title={loc.title} onClose={onClose} size="sm" footer={footer}>
      <p className={s.intro}>{loc.intro}</p>
      <div className={s.links}>
        <a className={s.linkRow} href={TELEGRAM_URL} target="_blank" rel="noreferrer noopener">
          <span className={s.linkIcon}><IconTelegram /></span>
          <span>{loc.telegram}</span>
        </a>
        <a className={s.linkRow} href={SITE_URL} target="_blank" rel="noreferrer noopener">
          <span className={s.linkIcon}><IconSite /></span>
          <span>{loc.site}</span>
        </a>
        <a className={s.linkRow} href={`mailto:${EMAIL}`}>
          <span className={s.linkIcon}><IconMail /></span>
          <span>{loc.email}</span>
        </a>
      </div>
      <p className={s.shareNote}>{loc.shareNote}</p>
    </SgDialog>
  );
}
