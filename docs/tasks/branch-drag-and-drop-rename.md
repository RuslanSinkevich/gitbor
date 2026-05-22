# Задача: drag & drop переименование веток между папками сайдбара

> Стартовый промпт для нового агентского таба. Скопируй в новый чат.

---

## Проблема

В сайдбаре ветки группируются по `/` в дерево папок (см. `BranchTree.tsx`, `buildBranchTree`). Перенести ветку из одной папки в другую сейчас никак — только через context menu → rename с ручным вводом нового пути.

В Fork: тянешь ветку в другую папку → отпускаешь → всплывает модал с готовым новым именем в инпуте → подтверждаешь → ветка физически переименована (`git branch -m old new`) и дерево перестраивается.

## Цель

Реализовать drag & drop веток между папками с подтверждающим диалогом.

## Что сделать

### Drag-source

В `src/renderer/src/features/sidebar/BranchTree.tsx`:

- `BranchTreeItem` для узла-листа (`branch != null`) делаем `draggable`;
- `onDragStart` пишет в `dataTransfer` payload `{ kind: 'branch', name: branch.name, isLocal: !branch.isRemote }`;
- курсор `grab` / `grabbing` через CSS.

Remote-ветки и теги — **не drag-source** на первом этапе (rename remote-ref требует push с force-delete старого, отдельная задача).

### Drop-target

Drop-зона — папка (`isFolder && !branch`) и корневой контейнер «Локальные ветки». Не лист, не другая ветка.

- `onDragOver`: `preventDefault()`, выставить эффект `move`, подсветить папку рамкой;
- `onDragLeave`: убрать подсветку;
- `onDrop`: вычислить новый full-path = `<folderFullPath>/<oldLeafName>`. Если drop в корень — `<oldLeafName>` без префикса.

### Диалог подтверждения

Используем `SgPromptDialog` (уже есть в `src/renderer/src/ui/SgPromptDialog.tsx`):

- title: `loc.sidebar.moveBranch` («Переместить ветку»);
- label: показывает `oldName → newName`;
- input: предзаполнен `newName`, юзер может править (например, сменить leaf-segment);
- кнопки: `Move` (primary) / `Cancel`;
- Enter — подтверждение, Esc — отмена.

Если новое имя совпадает со старым — кнопка `Move` disabled.

### Backend

Используем существующую команду rename — `{ type: 'renameBranch', from, to }` (проверить в `src/core/bridge/messages.ts`, если нет — добавить, под капотом `git branch -m`).

Edge cases:
- если ветка checked-out (`isCurrent`) — `git branch -m` работает без проблем, ничего особенного;
- если такая ветка уже есть — git вернёт ошибку, показать toast «ветка с таким именем уже существует»;
- если новое имя невалидное (`refs/heads/`-правила) — preflight через `git check-ref-format` или просто полагаемся на ошибку git и показываем её.

### State refresh

После успешного rename: обновить branches и сразу перерисовать дерево. Состояние «развёрнуто/свёрнуто» папок (`folderExpand` в Sidebar) должно сохранить целевую папку **развёрнутой**, чтобы юзер увидел куда ветка переехала.

## Не делать

- Drag нескольких веток сразу — нет use-case.
- Drag папок целиком («переименовать `feature/*` в `archive/feature/*`») — отдельная задача, требует batch rename и подтверждение со списком.
- Drag из одного репо в другой — git так не умеет, требует cherry-pick.

## i18n

- ru: `sidebar.moveBranch` = «Переместить ветку», `sidebar.moveBranchPrompt` = «Новое имя для ветки {old}:».
- en: `sidebar.moveBranch` = "Move branch", `sidebar.moveBranchPrompt` = "New name for {old}:".

## Тесты

- unit на helper построения нового имени (`computeMovedBranchName(oldFullName, targetFolderPath)`);
- e2e: создать `feature/a`, перетащить в папку `archive`, проверить что в `git branch` есть `archive/a` и нет `feature/a`.

## Запуск

Реализуй задачу из `docs/tasks/branch-drag-and-drop-rename.md`. Без лишних вопросов.
