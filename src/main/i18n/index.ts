import { ru } from './ru';
import { en } from './en';
import { app } from 'electron';

type DeepString<T> = { [K in keyof T]: T[K] extends object ? DeepString<T[K]> : string };
export type MainLocale = DeepString<typeof ru>;
export type LangCode = 'ru' | 'en';

const locales: Record<LangCode, MainLocale> = { ru, en };

let currentLang: LangCode = 'ru';

export function initLang(): void {
  const sysLang = app.getLocale();
  currentLang = sysLang.startsWith('ru') ? 'ru' : 'en';
}

export function setLang(lang: string): void {
  currentLang = lang.startsWith('ru') ? 'ru' : 'en';
}

export function getLang(): LangCode {
  return currentLang;
}

export function t(): MainLocale {
  return locales[currentLang];
}
