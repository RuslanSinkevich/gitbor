// Стрипает ANSI escape-последовательности (цвета, курсор) из текста.
// Нужно для вывода stderr хуков типа husky/lint-staged: они печатают
// цветными chalk-овскими строками вроде `\u001b[33m[STARTED]\u001b[39m`,
// и в обычном <pre> это выглядит как мусор `[33m[STARTED][39m`.
// Регулярка покрывает CSI (Control Sequence Introducer) последовательности.
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\u001b\[[0-9;?]*[A-Za-z]/g;

export function stripAnsi(input: string | null | undefined): string {
  if (!input) return '';
  return input.replace(ANSI_RE, '');
}
