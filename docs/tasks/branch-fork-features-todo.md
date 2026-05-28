# Fork-style фичи на ветках — TODO (v2)

> **Сделано:** Pin branches + hover-actions инфра, SVG-иконки (pin/filter/eye-off/info),
> зелёная точка перед именем ветки, stash без `On <branch>:` в sidebar.

---

## Задача 1: Переделать Branch Info

**Проблема:** Текущий `BranchInfoDialog` показывает read-only сводку
(name, SHA, upstream, last commit). Это **не то, что нужно**.

**Нужно:**
1. **Модалка с textarea** — пользователь может написать произвольные заметки
   о ветке: зачем она, что делать, ссылки на задачи и т.п.
2. **Persist per-repo per-branch** — заметки хранятся в localStorage
   (ключ: `sg-branch-notes:<repoPath>`, значение: `Record<branchName, string>`).
3. **Tooltip при hover на ℹ** — если у ветки есть заметка, при наведении
   на кнопку ℹ показать `SgTooltip` с текстом заметки (первые ~200 символов).
   Если заметки нет — tooltip «Нет описания, кликните чтобы добавить».
4. **Клик на ℹ** — открывает модалку с textarea, кнопка Сохранить.

**Файлы:**
- `branchPrefsPersist.ts` — добавить `loadBranchNotes(repoPath)`,
  `saveBranchNote(repoPath, branchName, text)` (localStorage).
- `BranchInfoDialog.tsx` — полная переделка: убрать `getCommitDetails`,
  вместо этого textarea + save button. Title: «Заметка — <branch>».
- `BranchTree.tsx` — на ℹ-кнопке обернуть в `SgTooltip` с текстом заметки.
  Прокинуть `notes: Record<string, string>` через `BranchPrefsAPI`.
- `useBranchPrefs.ts` — добавить `notes`, `setNote(branch, text)`.
- i18n: добавить `sidebar.branchNote`, `sidebar.branchNoteEmpty`,
  `sidebar.branchNoteSave`.

---

## Задача 2: Hide branch — полное скрытие из графа

**Проблема:** Текущий план предполагал dim (opacity 0.35) скрытых коммитов.
Это **не то** — смысл Hide в том, что ветка **полностью убирается из графа**,
layout пересчитывается без неё, как будто её нет.

**Подход — точно такой же, как Solo, но инвертированный:**
1. Собрать tips всех **не**-hidden локальных веток.
2. BFS от этих tips → `visibleReachable: Set<string>`.
3. `filtered = commits.filter(c => visibleReachable.has(c.hash))`.
4. `computeGraphLayout(filtered)` — пересчитать layout.
5. Передать в `CommitGraph`.

**Взаимодействие с Solo:**
- Если есть `soloBranch` — hidden игнорируется (solo жёстче).
- Если `soloBranch` скрыт — solo автоматически сбрасывается.

**Edge cases:**
- Скрыли все ветки → пустой граф + баннер «Все ветки скрыты [Показать все]».
- HEAD на скрытой ветке → HEAD всё равно показывается (UX: нельзя потерять
  текущую ветку). Альтернатива: запретить скрытие текущей ветки.

**Файлы:**
- `CommitsView.tsx` — `useGraphFilter(commits, layout, branches, soloBranch, hidden)`.
  Единый хук, который объединяет Solo + Hide. Один `useMemo`, один пересчёт.
- `CommitGraph.tsx` — никаких изменений (получает уже filtered данные).
- `App.module.css` — баннер `graphFilterBanner` (sticky, accent border).

---

## Задача 3: Solo graph filter

Без изменений по сравнению с предыдущим планом — client-side BFS +
`computeGraphLayout`. Объединить в один хук `useGraphFilter` с Hide.

---

## Задача 4: Lint + tests + commits + docs

После каждой задачи:
- `npx tsc --noEmit` обе зоны
- `npx eslint` изменённые файлы
- `npx vitest run`
- коммит с описательным сообщением
- обновить docs (features, architecture, README) + gitbor-web

---

## Задача 5: Stale diff после операций (merge, commit, stash и др.)

**Проблема:** После некоторых git-операций (merge, commit, stash pop,
cherry-pick, rebase, discard changes, stage/unstage all) в правой панели
остаётся открытый diff последнего файла. Файл мог уже не существовать,
быть пустым или не иметь изменений — diff показывает устаревшие данные.
Баг плавающий: зависит от порядка действий и timing'а state-обновлений.

**Что нужно найти и проверить:**

Все места, где после завершения операции должен сбрасываться `diffTarget`:

1. **Commit** — после успешного коммита файлы из staging ушли. `closeDiff()`.
2. **Merge** — после merge diff рабочей копии может стать невалидным. `closeDiff()`.
3. **Stash / Stash Pop** — старый diff невалиден. `closeDiff()`.
4. **Cherry-pick** — аналогично merge.
5. **Rebase (continue / abort / skip)** — состояние файлов полностью
   меняется. `closeDiff()`.
6. **Discard changes (single file / all)** — файл откачен, diff пуст.
7. **Stage All / Unstage All** — diff может ссылаться на изменённый контекст.
8. **Reset (soft/mixed/hard)** — после hard reset diff точно невалиден.
9. **Checkout branch** — diff рабочей копии от старой ветки невалиден.
10. **Pull** — если pull принёс merge или ff, diff может устареть.

**Где искать в коде:**

- `App.tsx` — `closeDiff()`, обработчики операций.
- `useAppState.ts` — подписка на `mainEvent`, `stateUpdate` / `fullState`.
- `ChangesView.tsx` — переключение `staged ↔ unstaged`, сброс списка файлов.
- `useDiffState.ts` — логика авто-закрытия.

**Подход:**

Самый надёжный — подписаться на `lastOpResult`: если операция записи
успешна, вызвать `closeDiff()`. Покроет все кейсы одним обработчиком.

---

## Что НЕ делать

- НЕ менять `git log --all` в `RepoStateRefresher.refreshGraph`
- НЕ добавлять новые IPC для фильтрации — всё client-side
- НЕ ломать WeakMap-кэши в `CommitGraph.tsx`
- НЕ показывать last commit в Info-модалке (это **не** её назначение)
- НЕ использовать dim/opacity для Hide (нужно полное скрытие + relayout)
