import type { FileHistoryEntry } from './types';

const SEPARATOR = '\x00';
const FORMAT = ['%H', '%h', '%s', '%an', '%at'].join('%x00');

export { FORMAT as FILE_HISTORY_FORMAT };

/**
 * Parse output of `git log --follow --format=<FORMAT> --name-status -- <file>`.
 * FORMAT uses `%x00` field separators (NUL in stdout only; avoids NUL in process argv).
 *
 * Реальная структура вывода git:
 *   <meta>\n           ← 5 полей через NUL
 *   \n                 ← пустая строка (от формата)
 *   <STATUS>\t<PATH>\n  ← name-status (для rename: R100\told\tnew)
 *   <meta>\n           ← следующий коммит СРАЗУ, без пустой строки-разделителя
 *   ...
 *
 * Наивный `split('\n\n')` + шаг 2 рассинхронизировался: между status одного
 * коммита и meta следующего нет `\n\n`, из-за чего в hash попадал мусор
 * («M\t<path>\n<hash>»), а половина коммитов терялась. Разбираем построчно:
 * meta-строку узнаём по наличию NUL (в путях/статусах NUL не бывает), первая
 * непустая строка без NUL после meta — это name-status.
 */
export function parseFileHistory(stdout: string): FileHistoryEntry[] {
  const entries: FileHistoryEntry[] = [];
  let current: FileHistoryEntry | null = null;
  let awaitingStatus = false;

  for (const raw of stdout.split('\n')) {
    const line = raw.trim();
    if (line === '') continue;

    if (line.includes(SEPARATOR)) {
      const parts = line.split(SEPARATOR);
      if (parts.length < 5) continue;
      current = {
        hash: parts[0],
        shortHash: parts[1],
        subject: parts[2],
        authorName: parts[3],
        authorDate: parseInt(parts[4], 10) * 1000,
        status: 'M',
      };
      entries.push(current);
      awaitingStatus = true;
    } else if (current && awaitingStatus) {
      // Первая name-status строка коммита: R100/A/M/D → берём первый символ.
      current.status = line.charAt(0) || 'M';
      awaitingStatus = false;
    }
  }

  return entries;
}
