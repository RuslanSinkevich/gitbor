interface Props {
  size?: number;
  /** Маленький дополнительный sparkle для большей читаемости иконки. */
  withSecondary?: boolean;
  className?: string;
}

/**
 * Единый AI-маркер для всех Tier-2 кнопок (Commit Explainer / Reflog /
 * Conflict / Stash Suggest / Semantic Search toggle). Sparkle 4-лучевая +
 * (опц.) маленькая sparkle справа-снизу.
 */
export function AiIcon({ size = 13, withSecondary = true, className }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
      className={className}
    >
      <path d="M8 1.5L9.6 6.4L14.5 8L9.6 9.6L8 14.5L6.4 9.6L1.5 8L6.4 6.4L8 1.5Z" fill="currentColor" />
      {withSecondary && (
        <path
          d="M12.5 11L13.1 12.4L14.5 13L13.1 13.6L12.5 15L11.9 13.6L10.5 13L11.9 12.4L12.5 11Z"
          fill="currentColor"
          opacity="0.7"
        />
      )}
    </svg>
  );
}
