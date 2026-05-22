import type { t } from '../i18n';
import { SgDialog } from './SgDialog';
import s from './AboutDialog.module.css';

interface Props {
  onClose: () => void;
  loc: ReturnType<typeof t>;
}

export function AboutDialog({ onClose, loc }: Props) {
  return (
    <SgDialog
      open
      title="GitBor"
      onClose={onClose}
      size="sm"
      footer={
        <button className="sg-button sg-button--primary sg-button--sm" onClick={onClose}>
          {loc.dialog.close}
        </button>
      }
    >
      <p className={s.version}>v0.1.0</p>
      <p className={s.desc}>{loc.aboutDialog.product}</p>
      <div className={s.section}>
        <h3 className={s.sectionTitle}>{loc.aboutDialog.aboutMeTitle}</h3>
        <p className={s.authorName}>{loc.aboutDialog.authorName}</p>
        <p className={s.sectionText}>{loc.aboutDialog.authorRole}</p>
        <p className={s.sectionText}>{loc.aboutDialog.authorBio}</p>
        <a
          className={s.link}
          href="https://gitbor.ru/about"
          target="_blank"
          rel="noreferrer"
        >
          {loc.aboutDialog.more}
        </a>
      </div>
      <p className={s.copy}>&copy; 2026 Ruslan Sinkevich</p>
    </SgDialog>
  );
}
