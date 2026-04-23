import { ru } from './ru';
import { en } from './en';
import { loadStoredString, saveStoredString } from '../shared/uiPersist';
export { useLocale } from './useLocale';

type DeepString<T> = { [K in keyof T]: T[K] extends object ? DeepString<T[K]> : string };
export type LocaleMap = DeepString<typeof en>;
export type Locale = LocaleMap;
export type LangCode = 'ru' | 'en';

const locales: Record<LangCode, Locale> = { ru, en };

let currentLang: LangCode = (loadStoredString('sg-lang') as LangCode) ?? 'ru';
const listeners = new Set<(lang: LangCode) => void>();

export function setLang(lang: string): void {
  const next: LangCode = lang.startsWith('ru') ? 'ru' : 'en';
  if (next === currentLang) return;
  currentLang = next;
  saveStoredString('sg-lang', next);
  listeners.forEach(fn => fn(next));
}

export function getLang(): LangCode {
  return currentLang;
}

export function t(): Locale {
  return locales[currentLang];
}

export function onLangChange(fn: (lang: LangCode) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function tpl(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(params[key] ?? `{${key}}`));
}
