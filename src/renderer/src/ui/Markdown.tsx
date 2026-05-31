import { Fragment, type ReactNode } from 'react';
import s from './Markdown.module.css';

/**
 * Минимальный безопасный Markdown-рендер. Без внешних парсеров и без
 * dangerouslySetInnerHTML — собираем React-узлы вручную, поэтому XSS
 * невозможен в принципе. Покрываем то, что реально пишут в заметках по
 * ветке: заголовки, списки, жирный и курсив, inline-code, ссылки вида
 * [text](url) и «голые» URL.
 *
 * Ссылки рендерятся как обычный anchor target=_blank; в Electron main перехватывает
 * `will-navigate`/`setWindowOpenHandler` и открывает их во внешнем браузере
 * (см. src/main/main.ts), внутри окна навигация запрещена.
 */

interface Props {
  text: string;
  className?: string;
}

const URL_RE = /(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;
const INLINE_RE =
  /(\[[^\]]+\]\([^)]+\))|(\*\*[^*]+\*\*)|(`[^`]+`)|(\*[^*]+\*)|(_[^_]+_)/g;

function sanitizeUrl(url: string): string | null {
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return null;
}

function Link({ href, children }: { href: string; children: ReactNode }) {
  const safe = sanitizeUrl(href);
  if (!safe) return <>{children}</>;
  return (
    <a href={safe} target="_blank" rel="noreferrer noopener" className={s.link}>
      {children}
    </a>
  );
}

/** Разбить «голый» текст на текст + автоссылки. */
function linkifyPlain(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  URL_RE.lastIndex = 0;
  let i = 0;
  while ((m = URL_RE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <Link key={`${keyBase}-u${i++}`} href={m[0]}>
        {m[0]}
      </Link>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Инлайновое форматирование одной строки. */
function renderInline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  INLINE_RE.lastIndex = 0;
  let i = 0;
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > last) out.push(...linkifyPlain(text.slice(last, m.index), `${keyBase}-p${i}`));
    const token = m[0];
    const key = `${keyBase}-t${i++}`;
    if (token.startsWith('[')) {
      const close = token.indexOf(']');
      const label = token.slice(1, close);
      const url = token.slice(token.indexOf('(', close) + 1, token.length - 1);
      out.push(
        <Link key={key} href={url}>
          {label}
        </Link>,
      );
    } else if (token.startsWith('**')) {
      out.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('`')) {
      out.push(
        <code key={key} className={s.code}>
          {token.slice(1, -1)}
        </code>,
      );
    } else {
      out.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    last = m.index + token.length;
  }
  if (last < text.length) out.push(...linkifyPlain(text.slice(last), `${keyBase}-pend`));
  return out;
}

export function Markdown({ text, className }: Props) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code fence ``` ... ```
    if (line.trim().startsWith('```')) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        buf.push(lines[i]);
        i++;
      }
      i++; // закрывающая ```
      blocks.push(
        <pre key={key++} className={s.pre}>
          <code>{buf.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    // Заголовки
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const content = renderInline(heading[2], `h${key}`);
      const cls = level === 1 ? s.h1 : level === 2 ? s.h2 : s.h3;
      blocks.push(
        <div key={key++} className={cls}>
          {content}
        </div>,
      );
      i++;
      continue;
    }

    // Списки (маркированные / нумерованные)
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items: ReactNode[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        const item = lines[i].replace(/^\s*([-*]|\d+\.)\s+/, '');
        items.push(<li key={items.length}>{renderInline(item, `li${key}-${items.length}`)}</li>);
        i++;
      }
      blocks.push(
        ordered ? (
          <ol key={key++} className={s.list}>
            {items}
          </ol>
        ) : (
          <ul key={key++} className={s.list}>
            {items}
          </ul>
        ),
      );
      continue;
    }

    // Пустая строка — пропускаем (разделитель параграфов)
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Параграф: собираем подряд идущие непустые не-блочные строки
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].trim().startsWith('```') &&
      !/^(#{1,3})\s+/.test(lines[i]) &&
      !/^\s*([-*]|\d+\.)\s+/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={key++} className={s.p}>
        {para.map((pl, idx) => (
          <Fragment key={idx}>
            {idx > 0 && <br />}
            {renderInline(pl, `p${key}-${idx}`)}
          </Fragment>
        ))}
      </p>,
    );
  }

  return <div className={`${s.md} ${className ?? ''}`}>{blocks}</div>;
}
