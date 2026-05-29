import { t } from '../../i18n';
import s from './AiSections.module.css';

interface Props {
  text: string;
  className?: string;
}

/**
 * Структурированный рендер AI-ответа. Делим по пустым строкам; если
 * первая строка параграфа короткая (<60 символов) и заканчивается на ':',
 * считаем её заголовком секции — рендерим капсом серым; остальной текст
 * — обычным с pre-wrap. Промпты Tier-2 фич приучены отдавать ответ в виде
 * `Label:` + текст, благодаря чему получается читабельная карточка.
 *
 * Никаких внешних markdown-парсеров — наш формат предсказуемый, парсер
 * крошечный, на стримящемся тексте работает на каждый чанк без аллокаций
 * сверх split.
 */
export function AiSections({ text, className }: Props) {
  // Модель отдаёт заголовки секций на английском (Ours/Theirs/Risk/...),
  // даже когда тело ответа на русском. Локализуем известные лейблы здесь,
  // не полагаясь на перевод моделью; незнакомые оставляем как есть.
  const sectionLabels = t().aiTier2.sectionLabels;
  const paragraphs = text.replace(/\r\n/g, '\n').split(/\n{2,}/);
  return (
    <div className={`${s.sections} ${className ?? ''}`}>
      {paragraphs.map((p, i) => {
        const trimmed = p.trim();
        if (!trimmed) return null;
        const firstNewline = trimmed.indexOf('\n');
        const firstLine = firstNewline >= 0 ? trimmed.slice(0, firstNewline) : trimmed;
        const rest = firstNewline >= 0 ? trimmed.slice(firstNewline + 1).trim() : '';
        const isHeader = firstLine.length < 60 && firstLine.trim().endsWith(':') && rest.length > 0;
        if (isHeader) {
          const rawTitle = firstLine.replace(/:\s*$/, '').trim();
          const title = sectionLabels[rawTitle.toLowerCase()] ?? rawTitle;
          return (
            <div key={i} className={s.section}>
              <div className={s.sectionTitle}>{title}</div>
              <div className={s.sectionBody}>{rest}</div>
            </div>
          );
        }
        return (
          <div key={i} className={s.section}>
            <div className={s.sectionBody}>{trimmed}</div>
          </div>
        );
      })}
    </div>
  );
}
