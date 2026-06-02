/**
 * Иконки для diff-тулбара. Свой набор глифов (16x16, stroke currentColor) —
 * единый стиль с остальными тулбарами приложения. Каждый глиф читается как
 * метафора режима: inline = один столбец строк, split = две панели,
 * whole = страница файла, whitespace = средние точки, expand = угловые скобки.
 */

const base = {
  width: 14,
  height: 14,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export const InlineIcon = () => (
  <svg {...base}>
    <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
    <line x1="5" y1="6.25" x2="11" y2="6.25" />
    <line x1="5" y1="8.5" x2="9" y2="8.5" />
    <line x1="5" y1="10.75" x2="11" y2="10.75" />
  </svg>
);

export const SplitIcon = () => (
  <svg {...base}>
    <rect x="2.25" y="3" width="5" height="10" rx="1.2" />
    <rect x="8.75" y="3" width="5" height="10" rx="1.2" />
  </svg>
);

export const WholeFileIcon = () => (
  <svg {...base}>
    <path d="M4.25 2.5h4l3.5 3.5v7.25a.75.75 0 0 1-.75.75H4.25a.75.75 0 0 1-.75-.75V3.25a.75.75 0 0 1 .75-.75Z" />
    <path d="M8 2.5v3.25h3.5" />
    <line x1="5.5" y1="9" x2="9.75" y2="9" />
    <line x1="5.5" y1="11" x2="9.75" y2="11" />
  </svg>
);

export const WhitespaceIcon = () => (
  <svg {...base}>
    <circle cx="4.75" cy="8" r="0.95" fill="currentColor" stroke="none" />
    <circle cx="8" cy="8" r="0.95" fill="currentColor" stroke="none" />
    <circle cx="11.25" cy="8" r="0.95" fill="currentColor" stroke="none" />
  </svg>
);

export const ExpandIcon = () => (
  <svg {...base}>
    <path d="M6 2.75H3.25V5.5" />
    <path d="M10 2.75h2.75V5.5" />
    <path d="M6 13.25H3.25V10.5" />
    <path d="M10 13.25h2.75V10.5" />
  </svg>
);
