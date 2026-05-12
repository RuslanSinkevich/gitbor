import { colorForAuthor } from '../shared/authorColor';
import s from './AuthorAvatar.module.css';

export type AuthorAvatarSize = 'sm' | 'md';

interface Props {
  name: string;
  email: string;
  size?: AuthorAvatarSize;
  /** Override the default `Name <email>` tooltip. */
  title?: string;
}

/**
 * Round identicon for a Git author. Background hue is a deterministic
 * function of the author's email, so the same person looks the same
 * everywhere in the UI. The label is 1-2 initials extracted from name
 * (Cyrillic supported) or, as a fallback, from the email local part.
 */
export function AuthorAvatar({ name, email, size = 'sm', title }: Props) {
  const { bg, fg, initials } = colorForAuthor(email, name);
  const sizeCls = size === 'md' ? s.md : s.sm;
  const fullTitle = title ?? (email ? `${name} <${email}>` : name || '?');
  return (
    <span
      className={`${s.avatar} ${sizeCls}`}
      style={{ background: bg, color: fg }}
      title={fullTitle}
      aria-label={fullTitle}
      data-testid="author-avatar"
    >
      {initials}
    </span>
  );
}
