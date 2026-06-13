/** Маленькие глифы для плашек рефов на графе (10px, stroke currentColor). */

const base = {
  width: 13,
  height: 13,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

/** Remote / синхрон с remote — как облако в Fork. */
export const RefCloudIcon = () => (
  <svg {...base} aria-hidden="true">
    <path d="M12.25 11.25H5.25a2.75 2.75 0 0 1-.35-5.45A3.25 3.25 0 0 1 10.75 5a2.25 2.25 0 0 1 1.5 4.25" />
  </svg>
);

/** Checked-out ветка (HEAD) — галочка вместо зелёной точки. */
export const RefCheckIcon = () => (
  <svg {...base} aria-hidden="true">
    <path d="M4.25 8.25L7 11l4.75-5" />
  </svg>
);
