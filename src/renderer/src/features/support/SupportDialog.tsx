import { t } from '../../i18n';
import { SgDialog } from '../../ui/SgDialog';
import s from './SupportDialog.module.css';

interface Props {
  open: boolean;
  onClose: () => void;
  onDismiss: () => void;
}

const DONATE_SUMS = [300, 500, 1000, 5000] as const;
/**
 * Донаты через CloudTips (Т-Банк): СБП, T-Pay или карта на одной странице.
 * Раньше был ЮMoney — платёж у Вадима падал «технической ошибкой».
 * `?amount=` CloudTips подставляет в поле суммы.
 */
const CLOUDTIPS_URL = 'https://pay.cloudtips.ru/p/cd782939';

function donateUrl(sum?: number): string {
  return sum ? `${CLOUDTIPS_URL}?amount=${sum}` : CLOUDTIPS_URL;
}

const IconHeart = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 21s-7.5-4.8-10-9.2C.6 9 1.6 5.6 4.8 5c2-.4 3.6.6 4.7 2 1.1-1.4 2.7-2.4 4.7-2 3.2.6 4.2 4 2.8 6.8C19.5 16.2 12 21 12 21z" />
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

      <div className={s.donateCard}>
        <div className={s.donateHead}>
          <span className={s.donateTitle}>
            <span className={s.heart}><IconHeart /></span>
            {loc.donateTitle}
          </span>
          <span className={s.donateSubtitle}>{loc.donateSubtitle}</span>
        </div>

        <div className={s.sums}>
          {DONATE_SUMS.map((sum) => (
            <a
              key={sum}
              className={s.sumBtn}
              href={donateUrl(sum)}
              target="_blank"
              rel="noreferrer noopener"
            >
              {sum} ₽
            </a>
          ))}
        </div>
        <a className={s.altBtn} href={donateUrl()} target="_blank" rel="noreferrer noopener">
          <span>{loc.cloudtips}</span>
          <span className={s.altHint}>{loc.cloudtipsHint}</span>
        </a>
      </div>

      <p className={s.shareNote}>{loc.shareNote}</p>
    </SgDialog>
  );
}
