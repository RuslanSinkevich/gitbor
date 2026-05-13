# GitBor — Ahead/Behind + Author Avatars (2026-05-11)

> **Status: DONE.**

## Цель

Закрыть две стандартные UX-фичи десктоп git-клиента (Fork / GitKraken /
SourceTree уровня): визуально отличать коммиты, прилетевшие fetch'ем, но
ещё не интегрированные в локальные ветки, и показывать на Toolbar
бейджи `ahead` / `behind` для текущей ветки. Параллельно — детерминированные
цветные аватарки авторов в графе и в Commit Details.

## Метрики до/после

| Метрика | До | После |
| --- | --- | --- |
| Tests (vitest) | 569 passed / 53 файлов | 601 passed / 55 файлов |
| Coverage statements | ~56.6% | 56.98% |
| Coverage branches | ~55.6% | 55.86% |
| Coverage lines | ~58.6% | 58.97% |
| Coverage functions | ~45.6% | 46.10% |
| Lint (src/ + tests/) | 0 errors / 3 warnings | 0 errors / 0 warnings |
| tsc main+renderer | clean | clean |
| Renderer main chunk | ~334 KB raw | 335.66 KB raw (+~1.6 KB на 2 фичи) |
| `npm run build` | OK | OK |

Базлайн взят из `docs/audit/polish-2026-05-11-2.md` и из локального запуска
тестов до начала стрима.

## Что сделано (по этапам)

### Этап 1 — Commit.isRemoteOnly

- `src/core/git/types/git.ts`: добавил обязательное поле `isRemoteOnly: boolean`
  в `Commit`.
- `src/core/git/GitParser.ts`: парсер ставит `isRemoteOnly: false` по
  умолчанию. Реальный флаг проставляется на этапе `RepoStateRefresher`.
- `src/core/state/remoteOnly.ts` — НОВЫЙ модуль с pure-функцией
  `parseRemoteOnlyHashes(stdout): Set<string>`. Чистый парсер вынесен
  отдельно, чтобы можно было покрыть тестами без спавна `git`.
- `src/core/state/RepoStateRefresher.ts`:
  - приватный `computeRemoteOnlySet(repoPath)`: вызывает
    `git rev-list refs/remotes --not refs/heads`, ловит любые ошибки
    (нет remote'ов, нет head'ов) и возвращает пустой Set;
  - `refreshGraph` после получения `commits` подмешивает флаг
    `isRemoteOnly = remoteOnly.has(c.hash)` ДО `computeGraphLayout`,
    чтобы layout получил уже-помеченные коммиты.

### Этап 2 — GraphNode.isRemoteOnly

- `src/core/git/types/graph.ts`: добавил обязательное поле `isRemoteOnly`
  в `GraphNode`.
- `src/core/git/GraphLayout.ts`: при сборке `GraphNode` копирую
  `commits[i].isRemoteOnly === true` (защита от `undefined` в legacy-кешах).
- `src/core/state/GraphCache.ts`: бамп `CACHE_VERSION` 1 → 2. Старые
  диск-кеши не имеют `isRemoteOnly`, отбрасываются на load → пересоздаются
  первым refresh'ем. Безопаснее, чем normalize-on-read.

### Этап 3 — Dim коммитов в графе

- `src/renderer/src/features/graph/branchPaths.ts`:
  - `BranchPathData` и `NodeCircle` получили поле `dimmed: boolean`;
  - `groupBranchPaths` помечает chain как `dimmed`, только если ВСЕ
    его сегменты касаются remote-only коммитов (передвинутый узел не
    "перекрашивает" нормальную ветку);
  - `getNodeCircles` зеркалит `node.isRemoteOnly`.
- `CommitGraph.tsx`:
  - SVG-узлы (`circle` / `polygon` для merge) и SVG-пути получают
    `opacity={0.45}` / `opacity={0.35}` если `dimmed`;
  - строка коммита получает класс `s.rowDimmed` + `title=loc.graph.remoteOnlyHint`;
  - `rowMeta` расширен полем `isRemoteOnly` для O(1) выдачи во время рендера;
  - `getOrComputeRowMeta` пересчитывает meta только на смену `nodes`-ссылки.
- `CommitGraph.module.css`: `.rowDimmed { opacity: 0.55 }`,
  `:hover { opacity: 0.9 }`, плавный transition.

### Этап 4 — Toolbar бейджи

- `Toolbar.tsx`: добавил props `ahead?: number` / `behind?: number`,
  заодно общий хелпер `formatBadgeCount(n)` с правилом `> 99 → "99+"`.
- `DropdownButton` получил пропсы `badge?: number` и `tooltip?: string`.
  Бейдж рендерится только при `badge > 0`.
- Tooltip кнопок Pull/Push разворачивается в локализованную строку
  (`pullBadge` / `pushBadge`) с подстановкой числа.
- `Toolbar.module.css`:
  - `.action { position: relative }`;
  - `.badge`: 16px-pill, top:-4/right:-4, фон `--sg-foreground`,
    текст `--sg-background`, opacity 0.85 — не яркий алерт, читаемо,
    подходит и под dark, и под light.
- `App.tsx`: прокинуты `ahead={state.ahead} behind={state.behind}`
  из существующего AppState.

### Этап 5-6 — Author Avatars

- НОВЫЙ `src/renderer/src/shared/authorColor.ts`:
  - `colorForAuthor(email, name?)` → `{ bg, fg, initials }`;
  - djb2-like хэш, hue = hash % 360, sat=55%, lit=50% → стабильный
    хороший контраст на тёмном фоне;
  - инициалы извлекаются с `\p{L}` (Cyrillic supported);
  - fallback-цепочка: name → email local-part → "?" в нейтрально-сером.
- НОВЫЙ `src/renderer/src/ui/AuthorAvatar.tsx` (+ `.module.css`):
  - размеры `sm` (18×18) / `md` (24×24);
  - tooltip = `Name <email>` (или просто name, если email пуст);
  - `aria-label` для скринридеров.
- Интеграция:
  - `CommitGraph.tsx` — рядом с `authorName` в каждой строке (`sm`);
  - `CommitDetails.tsx` — в строке Author (`md`).

### Этап 7 — i18n

В `toolbar` обоих локалей:

- `pullBadge: '{n} commit(s) to pull'` / `'Готово к получению: {n} коммит(ов)'`
- `pushBadge: '{n} commit(s) to push'` / `'Готово к отправке: {n} коммит(ов)'`

В `graph`:

- `remoteOnlyHint: 'Fetched from remote, not in any local branch yet'`
  / `'Загружен с remote, ещё не в локальной ветке'`

Существующий i18n-тест (`tests/i18n/i18n.test.ts`) автоматически проверил
совпадение ключей и совпадение placeholder'ов `{n}` между en/ru.

### Этап 8 — Tests

Новые файлы:

- `tests/state/computeRemoteOnly.test.ts` — 8 кейсов: empty, whitespace,
  одиночный hash, multi-line, CRLF, фильтрация пустых строк, dedup, smoke
  на необычный input.
- `tests/ui/authorColor.test.ts` — 16 кейсов: детерминизм, case-insensitive
  email, ASCII initials, Cyrillic initials, single-word, single-letter,
  fallback на email local-part, fallback при no-letter name, пустой
  email+name, `?` при только-цифровом email, 5 разных hue, email без `@`,
  fg=#ffffff, hue зависит от email а не от name, name как fallback-ключ
  для hue при пустом email.
- `tests/git/GraphLayout.test.ts` расширен (existing file) тремя кейсами
  в новом `describe('isRemoteOnly propagation')`: дефолт false на всех
  нодах, mirror индекс-в-индекс, mixed branch/merge.
- `tests/state/GraphCache.test.ts`, `tests/git/GraphLayout.test.ts`
  обновлены — helper'ы строят Commit/GraphNode с новым полем
  `isRemoteOnly: false`, иначе TypeScript ругался на required field.

Итог: было 569 / стало 601, +32 теста, +2 новых файла (computeRemoteOnly,
authorColor). Coverage держится в зелёной зоне и даже подрос
(parseRemoteOnlyHashes покрыт на 100%).

### Этап 9 — Docs

- `docs/features.md` + `docs/ru/features.md` — добавил подразделы про
  аватары и dim-render внутри "Commit Graph" + новый раздел
  "Ahead/Behind Indicators" / "Индикаторы ahead/behind".
- Этот файл (`docs/audit/feature-ahead-behind-avatars-2026-05-11.md`).

### Этап 11 — Чистка docs

Audit-файлы (`docs/audit/*.md`) по правилам стрима — hard-banned, не
трогаю. Они представляют ленту стримов и нужны для метрик «до/после»
у следующих фич. По остальным docs выполнил «минимально-инвазивную»
ревизию:

- `docs/getting-started.md` / `docs/ru/getting-started.md` — выровнял
  ссылки на актуальные секции в `features.md`, чтобы навигация не
  упиралась в мёртвые якоря на старые названия разделов;
- `docs/cross-platform-checklist.md` — отдельный быстрый раздел
  «Linked stream reports» уже актуален, не трогал;
- `docs/features.md` / `docs/ru/features.md` — добавил две новых
  секции этого стрима, лишнего ничего не было.

По итогам ревизии явных устаревших дублей вне audit-зоны не нашлось
(прошлые стримы A/B/C уже схлопнули таблицы и убрали повторы). От
агрессивной чистки воздержался: для соло-программиста ценность
лишней секции > риск удалить полезный контекст.

## Принятые решения

1. **`isRemoteOnly` как обязательное поле, не optional.** Required-флаг
   ловит на этапе типизации любое место, где Commit/GraphNode конструируется
   вручную (демо-граф для showcase, тестовые хелперы). Дешевле
   обновить 4 места сейчас, чем потом расследовать "почему dim иногда не
   работает".
2. **Чистый `parseRemoteOnlyHashes` отдельно.** Spawn git'а в юнит-тесте
   — это либо mock-фабрика на 50 строк, либо реальная подсистема,
   которую нельзя гонять в CI. Чистый парсер тестируется за 8 кейсов
   и покрывает 100% краёв (CRLF, dedup, пустые строки).
3. **Cache version 1 → 2 вместо normalize-on-read.** Normalize-on-read
   тянул бы за собой ещё один путь "что если поле undefined" + риск
   расхождения с GraphLayout. Бамп версии — это явный
   "старый формат → пересчитать", без скрытой логики.
4. **Dim chain только если ВСЕ сегменты remote-only.** Если chain
   проходит и через локальные коммиты, и через remote-only — это шов
   между интегрированной и не-интегрированной частью ветки. Логичнее
   оставить такую chain не-dimmed, потому что нижняя её часть уже в
   локальной ветке. Сегмент-к-сегменту dim давал бы рваный визуал.
5. **Бейдж по props, а не глобально в `DropdownButton`.** Сделано
   через optional `badge?: number`. Это позволяет в будущем тривиально
   добавить бейдж на любую другую DropdownButton (например, "Stash"),
   не трогая логику Toolbar.
6. **`hsl(hue, 55%, 50%)` фиксированы для аватарок.** L=50 → текст
   `#ffffff` всегда читаем. Sat=55 — не "ядовитые" чистые цвета, но
   достаточно различимые. Не делаю динамический контраст: формула
   `lit > 60 ? black : white` оставлена как hook, если в будущем
   захочется light-вариант палитры.
7. **`graphDemoData.ts` нарочно ставит `isRemoteOnly: false` всем
   демо-коммитам.** Это showcase, остаётся "чистым" примером графа без
   побочной семантики.

## Что не сделал и почему

- **Не добавил тест на полный E2E "после fetch'а в UI появился бейдж"**
  — это требует Playwright + реальный git push в тестовом репо. Уже
  есть `tests-e2e/open-repo.spec.ts` как scaffold, но для bейджа нужен
  отдельный fixture с remote'ом. Лежит как TODO следующего стрима.
- **Не подменял worker-thread layout-кеш на disk-уровне.** GraphCache
  сохраняет результат `computeGraphLayout`, флаги `isRemoteOnly` уже
  лежат в nodes — старый кеш v1 теперь невалиден, новый v2 будет содержать
  поля корректно. Никаких миграций не делаю.
- **Не сделал визуальный тест на dim-chain.** Pure-функция
  `groupBranchPaths` теперь возвращает `dimmed: boolean`, его легко
  покрыть, но это уже регресс-тест, не интеграционный — отложил, чтобы
  не раздувать стрим.

## Изменённые/созданные файлы

| Файл | Тип |
| --- | --- |
| `src/core/git/types/git.ts` | edit (Commit.isRemoteOnly) |
| `src/core/git/types/graph.ts` | edit (GraphNode.isRemoteOnly) |
| `src/core/git/GitParser.ts` | edit (default false) |
| `src/core/git/GraphLayout.ts` | edit (copy flag into node) |
| `src/core/state/RepoStateRefresher.ts` | edit (computeRemoteOnlySet + apply) |
| `src/core/state/GraphCache.ts` | edit (CACHE_VERSION 1→2) |
| `src/core/state/remoteOnly.ts` | **new** |
| `src/renderer/src/features/graph/CommitGraph.tsx` | edit (dim + avatar) |
| `src/renderer/src/features/graph/CommitGraph.module.css` | edit (.rowDimmed, .rowAuthor flex) |
| `src/renderer/src/features/graph/CommitDetails.tsx` | edit (md avatar) |
| `src/renderer/src/features/graph/CommitDetails.module.css` | edit (.authorLine) |
| `src/renderer/src/features/graph/branchPaths.ts` | edit (dimmed на BranchPathData/NodeCircle) |
| `src/renderer/src/features/toolbar/Toolbar.tsx` | edit (badges, tooltips, ahead/behind props) |
| `src/renderer/src/features/toolbar/Toolbar.module.css` | edit (.badge, position relative) |
| `src/renderer/src/App.tsx` | edit (прокинул state.ahead/behind) |
| `src/renderer/src/i18n/en.ts` | edit (toolbar.pullBadge/pushBadge, graph.remoteOnlyHint) |
| `src/renderer/src/i18n/ru.ts` | edit (то же на ру) |
| `src/renderer/src/pages/showcase/data/graphDemoData.ts` | edit (isRemoteOnly: false) |
| `src/renderer/src/shared/authorColor.ts` | **new** |
| `src/renderer/src/ui/AuthorAvatar.tsx` | **new** |
| `src/renderer/src/ui/AuthorAvatar.module.css` | **new** |
| `tests/state/computeRemoteOnly.test.ts` | **new** |
| `tests/ui/authorColor.test.ts` | **new** |
| `tests/git/GraphLayout.test.ts` | edit (+ isRemoteOnly describe) |
| `tests/state/GraphCache.test.ts` | edit (helper'ы заполняют isRemoteOnly) |
| `docs/features.md` | edit (Commit Graph + Ahead/Behind) |
| `docs/ru/features.md` | edit (тот же набор по-русски) |
| `docs/audit/feature-ahead-behind-avatars-2026-05-11.md` | **new** (этот файл) |
