/**
 * Персональные инсайты по автору, вычисляемые целиком на фронте из
 * `dailyCounts` (Record<'YYYY-MM-DD', number>). Бэкенд трогать не нужно —
 * данные уже приходят в AuthorStats.
 */

export interface AuthorInsights {
  /** Кол-во дней, в которые был хотя бы один коммит. */
  activeDays: number;
  /** Самая длинная серия подряд идущих активных дней. */
  longestStreak: number;
  /** Текущая серия (заканчивается на последнем активном дне). */
  currentStreak: number;
  /** Среднее число коммитов в активный день. */
  avgPerActiveDay: number;
  /** Коммиты по дням недели, индекс 0 = понедельник … 6 = воскресенье. */
  weekdayCounts: number[];
}

/** Сдвиг JS getDay() (0=Вс) к «понедельник первый» (0=Пн … 6=Вс). */
function mondayFirst(jsDay: number): number {
  return (jsDay + 6) % 7;
}

function dayDiff(a: string, b: string): number {
  const da = new Date(`${a}T00:00:00Z`).getTime();
  const db = new Date(`${b}T00:00:00Z`).getTime();
  return Math.round((db - da) / 86_400_000);
}

export function computeAuthorInsights(dailyCounts: Record<string, number>): AuthorInsights {
  const days = Object.keys(dailyCounts).filter(d => dailyCounts[d] > 0).sort();
  const weekdayCounts = [0, 0, 0, 0, 0, 0, 0];

  if (days.length === 0) {
    return { activeDays: 0, longestStreak: 0, currentStreak: 0, avgPerActiveDay: 0, weekdayCounts };
  }

  let totalCommits = 0;
  for (const d of days) {
    totalCommits += dailyCounts[d];
    const wd = mondayFirst(new Date(`${d}T00:00:00Z`).getUTCDay());
    weekdayCounts[wd] += dailyCounts[d];
  }

  let longest = 1;
  let run = 1;
  for (let i = 1; i < days.length; i++) {
    if (dayDiff(days[i - 1], days[i]) === 1) {
      run++;
      if (run > longest) longest = run;
    } else {
      run = 1;
    }
  }

  // Текущая серия — подряд идущие дни, заканчивающиеся последним активным.
  let current = 1;
  for (let i = days.length - 1; i > 0; i--) {
    if (dayDiff(days[i - 1], days[i]) === 1) current++;
    else break;
  }

  return {
    activeDays: days.length,
    longestStreak: longest,
    currentStreak: current,
    avgPerActiveDay: Math.round((totalCommits / days.length) * 10) / 10,
    weekdayCounts,
  };
}
