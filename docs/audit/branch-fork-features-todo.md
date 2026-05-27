# Fork-style фичи на ветках — TODO

Контекст: первая часть (Pin + Branch Info modal) реализована в коммите
`feat(sidebar): pin + branch info — Fork-style hover-actions`. Инфра под
все 4 фичи уже на месте:

- `branchPrefsPersist.ts` — per-repo localStorage (pinned / hidden / soloBranch);
- `useBranchPrefs(repoPath)` — хук-источник состояния (Sets для O(1) lookup,
  persist по записи);
- `BranchPrefsAPI` пробрасывается до `BranchTreeItem`;
- i18n-ключи `sidebar.{soloGraph, soloGraphActive, clearGraphFilter,
  hideBranch, unhideBranch}` уже добавлены;
- кнопки 🔍 и 👁 в `BranchHoverActions` уже рендерятся и зовут
  `prefs.toggleSolo(name)` / `prefs.toggleHide(name)` — сейчас они меняют
  только состояние, на граф пока не влияют.

То есть осталась **только графовая часть**. Бэк (`git log --all`) и
существующий пайплайн `RepoStateRefresher` трогать нельзя — фильтры
должны быть **client-side**, поверх готового `commits + graphLayout`.

## Задача 1: Solo graph filter

**UX:** клик 🔍 на ветке (или пункт меню «Показать только эту ветку») —
граф в `CommitsView` показывает только историю выбранной ветки. Над
графом — баннер «Граф фильтруется по `feature/x` [Сбросить]».

**Подход (client-side):**

1. В `CommitsView` принять `branchPrefs?: BranchPrefsAPI` через props
   (App уже держит `branchPrefsAPI` в стейте).
2. Сделать `useSoloGraphFilter(commits, layout, branches, soloBranch)`:
   - если `soloBranch == null` — вернуть оригинал;
   - найти `Branch` в `state.branches` по имени (только локальные);
   - BFS от `branch.hash` по `commit.parents` в `commits[]` — собрать
     `reachable: Set<string>`;
   - `filtered = commits.filter(c => reachable.has(c.hash))`;
   - если `filtered.length === commits.length` — вернуть оригинал
     (ветка покрывает весь граф, фильтр бессмыслен);
   - иначе вызвать `computeGraphLayout(filtered)` (импорт из
     `@core/git/GraphLayout`, pure-функция, inline в renderer ok для
     filtered-подмножеств).
3. Передать `filtered.commits + filtered.layout` в `CommitGraph`.
4. Баннер: новый `s.graphFilterBanner` в `App.module.css` (sticky сверху
   `graphPane`, accent border, кнопка `sg-button--sm sg-button--ghost`).
5. Solo пишется в localStorage через уже готовый `saveSoloBranch`,
   восстанавливается при открытии репо — никаких новых IPC.

**Edge cases:**
- tip ветки не в текущем срезе `commits` (load-more не дошёл) — отдаём
  оригинал, фильтр не применяется. Опционально показать toast «Tip ветки
  не загружен, нажмите Load More».
- BFS пробивает parents за пределы среза — игнорируем (см. инвариант
  `filtered ⊆ commits`).
- `searchMatchSet`, `compareFrom`/`compareTo`, `selectedHash` — все
  работают по hash'ам, после фильтра остаются корректными (просто не
  все строки видны).
- Дёрнули load-more при активном фильтре — `useMemo` пересчитает
  `filtered + layout`. Это **ожидаемо** один раз на load.

**Перф:** `computeGraphLayout(50k)` синхронно — ~50-150 мс. Inline-вызов
в `useMemo` подвиснет UI на этот период один раз на toggle. Если станет
заметно — обернуть в `workerPool.computeGraphLayout` (через
`postCommand`/новый IPC или прямой импорт `parserWorker` в renderer).
В большинстве случаев filtered-subset сильно меньше оригинала, layout
для него ~ms.

**Тесты:**
- unit на BFS (изолированный helper);
- unit на edge-cases (tip не найден, ветка покрывает всё);
- snapshot/RTL на баннер и его кнопку «Сбросить».

## Задача 2: Hide branch from graph

**UX:** клик 👁 на ветке — её reachable-уникальные коммиты (те, что
больше нигде не reachable, кроме hidden-веток) показываются с
пониженной opacity, как сейчас `isRemoteOnly`. Строка ветки в sidebar
получает зачёркнутый текст (стиль `.itemHiddenInGraph` уже добавлен).

**Подход (client-side):**

1. В `CommitsView` (или новом `useHiddenGraphDim`):
   - собрать `tipsByBranch: Map<branchName, hash>` из `state.branches`
     (только локальные);
   - для каждой **не**-hidden ветки запустить BFS по `parents` →
     накопить `visibleReachable: Set<string>`;
   - `dimmedHashes = new Set(commit.hash for commit in commits if
     !visibleReachable.has(commit.hash))`;
2. Прокинуть `dimmedHashes` в `CommitGraph` (новый optional prop).
3. В `getOrComputeNodeCircles` / `getOrComputeRowMeta` использовать тот
   же `nc.dimmed` / `rowMeta.isRemoteOnly`-флаг — добавить второй флаг
   `isHiddenByPrefs` или объединить в общий `dimmed`. Уже есть
   `BranchPathData.dimmed`, `NodeCircle.dimmed` — переиспользовать,
   расширив правило вычисления.
4. CSS: при `isRemoteOnly || isHiddenByPrefs` → `opacity: 0.35`.

**Архитектурные вопросы:**
- BFS по N веткам — O(N * commits). На 50k коммитов и сотне веток это
  до 5M операций. Нужен инкрементальный пересчёт: глобальный set с
  кэшем по `branches + hidden + commits`. `useMemo` подойдёт.
- Если **все** ветки скрыты — нечего показывать. Решение: пустой UI с
  баннером «Скрыты все ветки [Показать все]».
- Hide взаимодействует с Solo: когда есть soloBranch — hidden
  игнорируется (фильтр уже жёстче).

**Тесты:**
- unit на reachability (несколько веток, merge-коммиты).
- проверка корректности когда HEAD на hidden-ветке (UX-edge: HEAD
  скрыт, но текущее positioning не сломалось).

## Задача 3: Lint + tests + commits + docs

После каждой из задач 1-2:
- `npx tsc --noEmit` обе зоны;
- `npx eslint` изменённые;
- `npx vitest run` (особенно `tests/git/GraphLayout.test.ts` если
  трогали layout-обёртку);
- коммит с понятным сообщением;
- обновить `docs/features.md` + `docs/ru/features.md`, `README.md` +
  `docs/ru/README.md`, `docs/architecture.md` + `docs/ru/architecture.md`;
- обновить `gitbor-web` (landing + docs): `messages/en.json` +
  `messages/ru.json`, `src/content/docs/{en,ru}/branches.mdx` или
  `commit-graph.mdx` — добавить раздел про solo/hide.

## Что **не** делать

- НЕ менять `git log --all` в `RepoStateRefresher.refreshGraph`.
- НЕ добавлять новые IPC для фильтрации — всё client-side.
- НЕ ломать `branchPathsByNodes` / `nodeCirclesByNodes` / `rowMetaByNodes`
  WeakMap-кэши в `CommitGraph.tsx`: новые ссылки массивов автоматически
  получают новые кэш-entries, ничего инвалидировать вручную не нужно.
- Pin / Info остаются как есть — это первая часть, уже зарелизена.
