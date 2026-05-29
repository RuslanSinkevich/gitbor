# RepoManager: clone/init на модалках + рабочее клонирование — TODO

> **Контекст:** Текущий `RepoManager.tsx` рисует три кнопки
> (Открыть / Клонировать / Создать) и под ними **инлайн-формы** в самой
> панели списка. Это плохой UX: формы влезают в узкий 280-пиксельный
> сайдбар, поля обрезаются, нет валидации, нет «Обзора» для папки.
>
> Хуже того — клонирование **молча не работает**: юзер вставляет URL,
> жмёт «Клонировать», и ничего не происходит. Причина — `clonePath` пуст,
> кнопка `disabled={!cloneUrl.trim() || !clonePath.trim()}`, состояние
> кнопки никак не сигналит. Нет ни placeholder'а с примером, ни
> автоподстановки имени из URL.

---

## Задача 1: Перенести clone/init в `SgDialog`

**Проблема:** `panel: 'clone' | 'init'` + `<div className={s.inlineForm}>`
внутри `listPanel`. Эти inline-формы:
- ломают вертикальную ритмику списка недавних репо;
- не имеют фокусного управления (Esc / Enter не закрывают / не сабмитят
  как в нативной модалке `<dialog>`);
- не имеют единого с остальным приложением футера (Cancel / Confirm).

**Нужно:**
1. Убрать `panel` state, `inlineForm`, `formInput`, `formBtn` из
   `RepoManager.module.css`.
2. Создать два компонента-модалки:
   - `CloneRepoDialog.tsx` — поля URL + путь, кнопка «Обзор...», submit
     `cloneRepo`.
   - `InitRepoDialog.tsx` — поле «папка», кнопка «Обзор...», submit
     `initRepo`.
3. Оба используют `SgDialog` с `onConfirm` (готовый Cancel / Confirm
   футер), размер `sm` или `md`.
4. Кнопки в `RepoManager` остаются те же (Открыть / Клонировать /
   Создать), но вместо `setPanel(...)` — `setOpenDialog('clone' | 'init')`.

**Файлы:**
- `src/renderer/src/features/repo-manager/CloneRepoDialog.tsx` (новый)
- `src/renderer/src/features/repo-manager/InitRepoDialog.tsx` (новый)
- `src/renderer/src/features/repo-manager/RepoManager.tsx`
- `src/renderer/src/features/repo-manager/RepoManager.module.css`
  (убрать `.inlineForm`, `.formInput`, `.formBtn`)
- `src/renderer/src/features/repo-manager/index.ts` (если экспортируется)

---

## Задача 2: Кнопка «Обзор...» — IPC `pickDirectory`

**Проблема:** Сейчас нет способа открыть нативный picker и получить
путь обратно в renderer. `openRepoDialog` есть, но он сразу **открывает**
выбранную папку как репозиторий — для clone/init не подходит.

**Решение — новая команда, возвращающая путь:**

```ts
| { type: 'pickDirectory'; title?: string; defaultPath?: string }
```

Возвращает `string | null` (null если canceled).

**Файлы:**
- `src/core/bridge/messages.ts` — добавить тип команды в
  `RendererCommandCore`.
- `src/core/commands/CommandHandler.ts` — метод `pickDirectory(opts)`
  через `dialog.showOpenDialog` с `properties: ['openDirectory']`.
  Возвращает `result.filePaths[0]` или `null`.
- `src/core/bridge/ipc/handlersRepoExtras.ts` — handler возвращает
  результат `ctx.ch.pickDirectory(cmd)`.
- `src/renderer/src/api.ts` — добавить `pickDirectory` в
  `NON_RETRYABLE_TYPES` (это запрос, не write-op).
- Использовать в `CloneRepoDialog` / `InitRepoDialog` через
  `invokeCommand({ type: 'pickDirectory', ... })`.

**Дефолт `defaultPath`:**
- Для clone — последняя успешно использованная базовая папка
  (`localStorage[sg-clone-base-dir]`), либо `app.getPath('home')`.
- Для init — то же, ключ `sg-init-base-dir`.

---

## Задача 3: Автогенерация имени из URL + persist base dir

**Проблема:** Юзер вставил URL — поле «путь» по-прежнему пустое, кнопка
заблокирована, нет ни визуальной подсказки, ни автозаполнения.

**Поведение:**
1. На `onChange` URL парсим имя репо: последний сегмент после `/`,
   обрезаем `.git`. Регэксп: `/([^/]+?)(?:\.git)?\/?$/`.
2. Если базовая папка известна (`localStorage[sg-clone-base-dir]`) —
   автоподставляем `<base>/<repoName>` в `clonePath`. Только пока юзер
   САМ не отредактировал поле (флаг `pathDirty`).
3. После успешного клона — сохраняем `dirname(clonePath)` в
   `sg-clone-base-dir`.
4. Кнопка «Обзор...» — открывает picker с `defaultPath = base dir`;
   выбранная папка трактуется как **родительская** — финальный путь
   = `<chosen>/<repoName>`. Это даёт UX как у Fork / GitHub Desktop.

**Альтернатива (более явная):** Два отдельных поля — «Папка для
клонирования» (родитель) и «Имя папки» (имя репо, авто из URL,
редактируемо). Финальный путь = `path.join(parent, name)`. Показать
preview под полями: `Будет создано: C:/repos/my-project`.

**Решение:** Делаем второй вариант — два поля. Юзеру проще понять, что
происходит, проще править отдельно имя или родителя.

**Файлы:**
- `src/renderer/src/features/repo-manager/CloneRepoDialog.tsx`
- `src/renderer/src/features/repo-manager/cloneDirPersist.ts` (новый) —
  `loadCloneBaseDir()`, `saveCloneBaseDir(path)`, аналог для init.

---

## Задача 4: Валидация и обратная связь

**Проблема:** Сейчас при пустом URL/пути просто `disabled`, без
объяснения. Если клон упал (нет git, network, auth) — юзер вообще ничего
не увидит, кроме отсутствия нового репо в списке.

**Нужно:**
1. Под полем URL — inline-ошибка если строка непохожа на git-URL
   (валидация на focus-out): `https?://`, `git@`, `ssh://`, локальный
   путь. Не блокировать сабмит, только предупреждать.
2. Под полем «Имя папки» — ошибка если папка уже существует и непуста
   (можно проверить через тот же `pickDirectory` API? Нет — нужна
   отдельная invoke `fsCheckPath`. Но это можно отложить — текущее
   поведение git clone «destination path already exists» прокидывается
   через toast операций).
3. Hookнуться на `operationEnd` для `operation: 'clone'` — закрыть
   диалог только при `success: true`. При ошибке — оставить открытым,
   показать `error` строкой в футере.

**Файлы:**
- `CloneRepoDialog.tsx` — подписка на `onMainEvent` для отслеживания
  `operationStart/operationEnd` с `operation === 'clone'`.

---

## Задача 5: i18n

Добавить ключи в `src/renderer/src/i18n/{ru,en}.ts`:

```ts
repoManager: {
  ...,
  cloneTitle: 'Клонировать репозиторий',
  cloneParent: 'Папка для клонирования',
  cloneName: 'Имя папки',
  clonePreview: 'Будет создано:',
  cloneBrowse: 'Обзор...',
  cloneInvalidUrl: 'Похоже не на git URL',
  cloneInProgress: 'Клонирование...',
  cloneFailed: 'Не удалось клонировать: {error}',
  initTitle: 'Создать репозиторий',
  initParent: 'Папка для нового репозитория',
  initName: 'Имя папки',
  initBrowse: 'Обзор...',
}
```

Существующие `cloneUrl`, `clonePath`, `cloneStart`, `initPath`,
`initStart` оставить — будут переиспользованы внутри новых строк, либо
удалить если не нужны после миграции.

---

## Задача 6: Lint + тесты + коммит

После каждой задачи:
- `npx tsc --noEmit` (обе зоны)
- `npx eslint` изменённые файлы
- `npx vitest run` (особенно `tests/commands/writeCommands.test.ts` и
  `tests/bridge/helpers.test.ts` — там есть упоминания cloneRepo)
- Коммит с описательным сообщением вида
  `feat(repo-manager): clone/init dialogs + pickDirectory IPC`

---

## Что НЕ делать

- НЕ менять сигнатуру `cloneRepo` / `initRepo` в `writeCommands.ts` —
  бэкенд работает корректно, проблема чисто в UX.
- НЕ хранить `clonePath` / `cloneUrl` между сессиями. Только базовую
  папку.
- НЕ ломать `panel`-логику если в каких-то местах ещё ссылаются (быстрый
  grep по `'clone'` / `'init'` в `repo-manager/*`).
- НЕ добавлять в `pickDirectory` поддержку `properties: ['openFile']` —
  только директории, иначе размывается смысл команды.
