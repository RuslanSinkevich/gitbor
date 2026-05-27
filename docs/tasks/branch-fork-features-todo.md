# Fork-style фичи на ветках — TODO (v2)

> Первая версия Pin + Info + hover-actions реализована, но требует доработки.
> Solo graph пока не подключен к графу (toggle меняет state, но не фильтрует).
> Hide — пока тоже только state, визуально dim, а нужно полное скрытие.

## Задача 0: Иконки — убрать эмодзи, сделать SVG

**Проблема:** Сейчас `BranchHoverActions` рендерит 📌🔍👁ℹ — цветные эмодзи,
выглядят чужеродно и по-разному на разных ОС.

**Решение:** Заменить на inline SVG 12×12, одноцветный `currentColor`.
Проект уже использует Unicode-символы в sidebar (`⎇`, `☁`, `☰`), но для
hover-actions нужны более чёткие иконки. Четыре штуки:

| Действие | SVG-идея |
|----------|----------|
| Pin | Вертикальная булавка (pin). Линия + кружок на конце. |
| Solo | Одна ветка / линза (filter). Ломаная линия с одним ответвлением. |
| Hide | Глаз перечёркнутый / без зрачка (eye-off). |
| Info | Буква «i» в кружке. |

**Файл:** `BranchTree.tsx`, функция `BranchHoverActions`.
Заменить текстовое содержимое четырёх `<button>` на `<svg>` элементы.
CSS `.branchActionBtn` уже имеет `font-size: 10px` — заменить на
`width: 14px; height: 14px;` для SVG. `color: currentColor` уже работает
через `var(--sg-foreground-muted)` / `var(--sg-primary)` для active.

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

1. **Commit** — после успешного коммита файлы из staging ушли. Diff
   открытого staged-файла теперь пустой. Нужно `closeDiff()`.
2. **Merge** — после merge (fast-forward или с коммитом) diff рабочей
   копии может стать невалидным. `closeDiff()`.
3. **Stash / Stash Pop** — после stash рабочий файл чист, после pop
   файл изменился — старый diff невалиден. `closeDiff()`.
4. **Cherry-pick** — аналогично merge.
5. **Rebase (continue / abort / skip)** — состояние файлов полностью
   меняется. `closeDiff()`.
6. **Discard changes (single file / all)** — файл откачен, diff пуст.
   `closeDiff()` или хотя бы `closeDiff()` если discard'нули именно
   открытый файл.
7. **Stage All / Unstage All** — diff может ссылаться на
   `workingCopy`/`staged` контекст, который сменился. Как минимум
   обновить, в идеале сбросить.
8. **Reset (soft/mixed/hard)** — после hard reset diff точно невалиден.
9. **Checkout branch** — diff рабочей копии от старой ветки невалиден.
10. **Pull** — если pull принёс merge или ff, diff рабочей копии может
    стать устаревшим.

**Где искать в коде:**

- `App.tsx` — `closeDiff()` (setter `diffTarget → null`), `openDiff()`.
  Проверить все обработчики операций: `handleMerge`, `handleStash`,
  `handleCommit` и т.д. — зовут ли они `closeDiff()` после успеха.
- `useAppState.ts` — подписка на `mainEvent`. После `stateUpdate` /
  `fullState` проверить, не нужно ли инвалидировать открытый diff.
- `ChangesView.tsx` — при переключении `staged ↔ unstaged` и при
  полном сбросе списка файлов.
- `useDiffState.ts` — сам хук, есть ли там логика авто-закрытия.

**Подход:**

Самый надёжный — подписаться в `App.tsx` на `lastOpResult` (уже есть):
если операция **записи** успешна (`lastOpResult.success && write-op`),
вызвать `closeDiff()`. Это покроет **все** кейсы одним обработчиком.
Для тонкой гранулярности (закрывать только если файл затронут) —
сравнивать `diffTarget.file` с `lastOpResult.affectedFiles`, но это
сложнее и может не понадобиться.

Альтернатива: в `useAppState`, при получении нового `stateUpdate` с
изменённым `localChanges` / `stagedChanges`, проверять, есть ли
`diffTarget.file` в новом списке. Если нет — `closeDiff()`.

---

## Задача 6: Зелёная точка текущей ветки — перенести в начало строки

**Проблема:** Зелёная точка (`.itemBadge`) стоит **после** имени ветки
(правее `<span className={s.itemName}>`). Из-за этого при длинных именах
она уезжает далеко вправо или вообще не видна. В Fork точка/маркер стоит
**перед** именем — сразу бросается в глаза.

**Решение:**

1. В `BranchTree.tsx`, `BranchTreeItem`, рендер leaf-ветки — переместить
   `{branch.isCurrent && <span className={s.itemBadge} ... />}` **перед**
   `<span className={s.itemName}>`.
2. CSS `.itemBadge` — убрать `margin-left: 4px`, добавить `margin-right: 6px`.
3. Проверить, что точка не конфликтует с drag-handle и hover-actions.

**Файлы:** `BranchTree.tsx` (одна перестановка строк), `Sidebar.module.css`
(замена margin).

---

## Задача 7: Stash — скрыть имя ветки из видимого текста

**Проблема:** Кнопка «Отложить» (Stash) сохраняет через git формат
`On <branch>: <message>`. В sidebar stash-элемент показывает полный
`stash.message` — например `On feature/long-branch-name: WIP`. Имя
ветки занимает место и дублирует информацию (пользователь и так видит
ветку рядом).

**Решение:**

1. Парсить `stash.message` при рендере в sidebar: если начинается с
   `On <...>: ` — вырезать prefix, показать только user-message.
   Если user-message пустой — показать `stash@{N}`.
2. Полный оригинальный текст (с `On branch: ...`) показывать в
   `title` / `SgTooltip` при наведении — чтобы инфо о ветке не
   терялась, просто не занимала место.

**Файлы:**

- `Sidebar.tsx`, компонент `StashItem` (строка ~248):
  ```
  // сейчас:
  <span className={s.itemName}>{stash.message || `stash@{${stash.index}}`}</span>

  // нужно:
  const displayMsg = stripStashBranch(stash.message) || `stash@{${stash.index}}`;
  const fullMsg = stash.message || `stash@{${stash.index}}`;
  <span className={s.itemName} title={fullMsg}>{displayMsg}</span>
  ```
- Новая утилита `stripStashBranch(msg: string): string` — простой regex
  `/^On [^:]+:\s*/` → обрезать. Можно положить в сам `Sidebar.tsx`
  (приватная функция) или вынести в `shared/`.

**Edge cases:**
- Stash без кастомного сообщения: git пишет `On branch: WIP on branch hash`.
  После обрезки `On branch: ` останется `WIP on branch hash` — ок, это
  понятнее чем полный формат.
- Stash с пустым message: fallback на `stash@{N}`.
- Stash не по формату `On ...:` (старые версии git / ручной stash) —
  regex не матчит, показываем as-is.

---

## Что НЕ делать

- НЕ менять `git log --all` в `RepoStateRefresher.refreshGraph`
- НЕ добавлять новые IPC для фильтрации — всё client-side
- НЕ ломать WeakMap-кэши в `CommitGraph.tsx`
- НЕ показывать last commit в Info-модалке (это **не** её назначение)
- НЕ использовать dim/opacity для Hide (нужно полное скрытие + relayout)
