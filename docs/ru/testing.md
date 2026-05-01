> English version: [docs/testing.md](../testing.md)

# Тестирование SkyFork

## Стек

| Компонент | Версия |
|-----------|--------|
| Фреймворк | [Vitest](https://vitest.dev/) 4.x |
| Конфиг | `vitest.config.ts` (корень проекта) |
| Тесты | `tests/**/*.test.ts` |
| Среда | Node.js (без DOM) |

---

## Быстрый старт

```bash
# Установка зависимостей (если ещё не установлены)
npm install

# Запуск всех тестов
npm test

# То же самое напрямую
npx vitest run

# Watch-режим (перезапуск при изменении файлов)
npx vitest

# Запуск конкретного файла
npx vitest run tests/git/GitParser.test.ts

# Запуск по шаблону имени
npx vitest run --reporter=verbose GitParser
```

---

## Структура тестов

```
tests/
├── git/                          # Парсеры и менеджеры Git
│   ├── GitParser.test.ts         # Коммиты, ветки, теги, stash, remotes, status
│   ├── DiffParser.test.ts        # Парсинг unified diff
│   ├── ConflictParser.test.ts    # Парсинг конфликт-маркеров (<<<<<<< / >>>>>>>)
│   ├── ReflogParser.test.ts      # Парсинг git reflog
│   ├── BlameParser.test.ts       # Парсинг git blame
│   ├── SubmoduleParser.test.ts   # Парсинг submodule status и .gitmodules
│   ├── FileHistoryParser.test.ts # Парсинг истории файла
│   ├── GraphLayout.test.ts       # Алгоритм раскладки графа коммитов
│   ├── BisectManager.test.ts     # Контракт интерфейса BisectStatus
│   ├── HooksManager.test.ts      # Контракт интерфейса HookInfo
│   ├── LfsManager.test.ts        # Контракт интерфейса LfsStatus
│   ├── WorktreeManager.test.ts   # Worktree list/add/remove с мокнутым GitExecutor
│   ├── GitExecutor.test.ts       # Логика sanitizeArgs (редактирование чувствительных данных)
│   └── RebaseManager.test.ts     # Интерактивный rebase: парсинг todo, GIT_SEQUENCE_EDITOR
│
├── commands/
│   ├── writeCommands.test.ts     # stageFile (--), commit, push, initRepo, checkout, clone
│   ├── readCommands.test.ts      # log, status, branches, tags, stashes, remotes
│   └── ConflictManager.test.ts   # completeMerge, resolveWithOurs/Theirs, merge, predictConflicts
│
├── state/
│   ├── StateManager.test.ts      # Мульти-репо снимки, токены, подписчики, isRepoTracked гард
│   └── repoSlice.test.ts         # emptyRepoSlice, mirrorRepoSliceToAppState, hashGitStdout, GIT_*_FORMAT
│
├── services/
│   └── RepoServicesRegistry.test.ts # Per-repo lifecycle: acquire/release, kill, isolation A↔B
│
├── activity/
│   └── GitActivityStore.test.ts  # start/append/finish, per-repo, кэп 100, обрезка stdout/stderr
│
├── utils/
│   ├── pathSecurity.test.ts      # safePath traversal, isSafeFilename
│   ├── repoPathGuard.test.ts     # isDangerousRepoRoot (home/Windows/Program Files/...)
│   ├── AppError.test.ts          # AppError code/data/fallback, instanceof Error
│   └── Logger.test.ts            # Уровни (silent/error/warn/info/debug), stdout/stderr split, configureMainLogger
│
├── safety/
│   ├── OperationQueue.test.ts    # Очередь операций (read/write, сериализация, ошибки)
│   ├── AtomicWrite.test.ts       # Атомарная запись файлов (sync + async)
│   └── OperationJournal.test.ts  # WAL-журнал (lifecycle, cleanup, concurrency)
│
├── bridge/
│   ├── messages.test.ts          # IPC-контракты (RendererCommand, MainEvent)
│   └── helpers.test.ts           # ipc/helpers: op/opWithPostMerge снимок repoPath, errOnFail, runTracked
│
├── ai/
│   ├── AiConfigStore.test.ts     # Конфиг провайдера, шифрование через safeStorage
│   ├── AiHandlers.test.ts        # IPC хендлеры AI
│   ├── AiService.test.ts         # generateCommitMessage, testConnection
│   ├── OpenAiCompatibleProvider.test.ts # SSE-парсер, finishReason, usage
│   └── prompts.test.ts           # buildCommitSystemPrompt / buildCommitUserPrompt
│
└── i18n/
    ├── i18n.test.ts              # Полнота локализации (en ↔ ru ключи, плейсхолдеры)
    └── tpl.test.ts               # Шаблонный интерполятор {key}
```

---

## Что тестируется — подробно

### 1. GitParser (`tests/git/GitParser.test.ts`)

Модуль: `src/core/git/GitParser.ts`

| Функция | Что проверяется |
|---------|----------------|
| `parseRefs` | HEAD → branch, bare HEAD, тег, remote, локальная ветка, несколько ref-ов |
| `parseCommits` | Одиночный коммит, GPG-статус G/N, multiple parents, root commit, пустой ввод, строки с недостаточным числом полей |
| `parseBranches` | Локальные ветки, remote-ветки, текущая ветка (`*`), отсутствие upstream |
| `parseTags` | Обычные теги, пустые, пропуск строк без имени |
| `parseStashes` | Запись stash с index/hash/message |
| `parseRemotes` | fetch/push URL, несколько remote-ов |
| `parseStatus` | Staged/unstaged модификации, `MM` (обе), untracked (`??`), staged add (`A`), delete (`D`), конфликты (`UU`, `AA`), несколько файлов |
| `parseFileChanges` | Модификация, добавление, удаление, переименование (`R100`), копирование (`C100`) |

**347 тестов / 37 файлов — всё зелёное.**

### 2. DiffParser (`tests/git/DiffParser.test.ts`)

Модуль: `src/core/git/DiffParser.ts`

- Простая модификация (context + remove + add)
- Новый файл (`/dev/null` → `b/file`)
- Удалённый файл (`a/file` → `/dev/null`)
- Переименование (`rename from`/`rename to`)
- Бинарные файлы (`Binary files`)
- Несколько файлов в одном diff
- Несколько hunk-ов (`@@ ... @@`)
- Корректные номера строк в каждом hunk

### 3. ConflictParser (`tests/git/ConflictParser.test.ts`)

Модуль: `src/core/git/ConflictParser.ts`

- Один конфликт (`<<<<<<< / ======= / >>>>>>>`)
- Несколько конфликтов в одном файле
- Формат diff3 (3 секции: ours / base / theirs)
- Пустые стороны конфликта
- Неполные маркеры (graceful — не крашится)
- Конфликт не в начале файла

### 4. ReflogParser (`tests/git/ReflogParser.test.ts`)

Модуль: `src/core/git/ReflogParser.ts`

- `reflogArgs()` — корректные аргументы git с `--format` и `-n`
- `parseReflog()` — checkout, commit, сообщения с/без двоеточия
- Несколько записей
- Извлечение индекса из `HEAD@{N}`
- Пустой/невалидный ввод

### 5. BlameParser (`tests/git/BlameParser.test.ts`)

Модуль: `src/core/git/BlameParser.ts`

- Пустой ввод
- Одиночный блок blame (hash, author, date, line content)
- Несколько строк
- Пустые строки контента

### 6. SubmoduleParser (`tests/git/SubmoduleParser.test.ts`)

Модуль: `src/core/git/SubmoduleParser.ts`

**`parseSubmoduleStatus`:**
- Чистый субмодуль (` ` — статус "clean")
- Модифицированный (`+` — "modified")
- Неинициализированный (`-` — "uninitialized")
- Конфликт (`U` — "conflict")
- Несколько субмодулей

**`parseGitmodules`:**
- Пустой ввод
- Пары path + URL
- Несколько субмодулей
- Orphan-записи без URL (игнорируются)

### 7. FileHistoryParser (`tests/git/FileHistoryParser.test.ts`)

Модуль: `src/core/git/FileHistoryParser.ts`

- Пустой ввод
- Одна запись (hash, shortHash, subject, authorName, authorDate, status)
- Несколько записей (разделитель `\n\n`)
- Дефолтный статус `M` при отсутствии

### 8. GraphLayout (`tests/git/GraphLayout.test.ts`)

Модуль: `src/core/git/GraphLayout.ts`

- Пустой массив коммитов
- Линейная цепочка (каждый node.column = 0)
- Простое ветвление и merge
- Уникальные цвета у разных колонок
- Обработка unknown parent (без ошибок)

### 9. WorktreeManager (`tests/git/WorktreeManager.test.ts`)

Модуль: `src/core/git/WorktreeManager.ts`

- `list()` — парсинг porcelain вывода (main, linked, detached, bare worktrees)
- `add()` — вызов `git worktree add` с веткой
- `remove()` — вызов `git worktree remove`

### 9a. GitExecutor (`tests/git/GitExecutor.test.ts`)

- `sanitizeArgs` — редактирование значений после `-m`, `-C`, `-N`
- Сохранение нечувствительных аргументов

### 9b. RebaseManager (`tests/git/RebaseManager.test.ts`)

- `getTodoList` — парсинг лога, пустой лог
- `executeRebase` — `GIT_SEQUENCE_EDITOR` с `cp`, фильтрация drop
- `continueRebase`, `abortRebase`

### 9c. writeCommands (`tests/commands/writeCommands.test.ts`)

- `stageFile` — разделитель `--`, имена файлов на `-`
- `commit` — сообщение, amend, ошибки
- `initRepo` — cwd из родительского каталога
- `push`, `checkout`, `discardFileChanges`, `cloneRepo`

### 9d. ConflictManager (`tests/commands/ConflictManager.test.ts`)

- `completeMerge` — проверка exitCode коммита, неразрешённые конфликты
- `resolveWithOurs`/`resolveWithTheirs` — `--` перед путями
- `merge`, `predictConflicts`

### 9e. pathSecurity (`tests/utils/pathSecurity.test.ts`)

- `safePath` — обычные пути, traversal, absolute, вложенные, `..` в именах
- `isSafeFilename` — безопасные имена, разделители, спецсимволы, пустая строка

### 10. OperationQueue (`tests/safety/OperationQueue.test.ts`)

Модуль: `src/core/safety/OperationQueue.ts`

- Начальное состояние (нет записи, очередь пуста)
- Выполнение read/write операций
- Сериализация write-операций (строгий порядок)
- Параллельные read-операции (стартуют одновременно)
- Уведомления слушателей при начале/окончании
- Отписка слушателя
- Проброс ошибок из операций
- Продолжение работы очереди после ошибки

### 11. i18n (`tests/i18n/i18n.test.ts`)

Модули: `src/renderer/src/i18n/en.ts`, `src/renderer/src/i18n/ru.ts`

- Одинаковое количество ключей en ↔ ru
- Каждый ключ en существует в ru
- Каждый ключ ru существует в en
- Нет пустых строк в en
- Нет пустых строк в ru
- Плейсхолдеры `{name}` совпадают между языками
- Все верхнеуровневые секции присутствуют в обоих языках

### 12. Шаблонный интерполятор (`tests/i18n/tpl.test.ts`)

Модуль: утилита `tpl()` из i18n

- Одиночная подстановка `{name}`
- Несколько подстановок
- Числовые значения
- Отсутствующие ключи (остаются как `{key}`)
- Строка без плейсхолдеров (возвращается как есть)
- Повторяющиеся плейсхолдеры
- Пустой шаблон

### 13. RepoServicesRegistry (`tests/services/RepoServicesRegistry.test.ts`)

Модуль: `src/core/services/RepoServicesRegistry.ts`

- `acquire(repoPath)` идемпотентен (повторный вызов возвращает тот же объект сервисов)
- `acquire` для разных путей даёт разные `git`/`queue`/`safety`
- `bootstrap()` — singleton (для clone/init без открытого репо)
- `release(repoPath)` зовёт `git.killAll()` и удаляет из map; повторный `release` — no-op
- `disposeAll()` чистит репо-сервисы, bootstrap и listeners
- `onAnyOperationStatusChange` дёргается при write-операциях per-repo очереди
- **Изоляция**: длинный write на репо A не блокирует write на репо B (главный инвариант)

### 14. repoSlice (`tests/state/repoSlice.test.ts`)

Модуль: `src/core/state/repoSlice.ts`

- `emptyRepoSlice()` возвращает свежий объект (массивы не shared между вызовами)
- `mirrorRepoSliceToAppState` копирует репо-поля и НЕ трогает meta (`openRepos`/`activeRepoIndex`/running-флаги)
- `hashGitStdout` детерминирован, разные строки → разные md5
- Контракт `GIT_LOG_FORMAT` (8 NUL-полей), `GIT_REF_FORMAT` (4), `GIT_TAG_REF_FORMAT` (2), `GIT_STASH_FORMAT` (`%gd`/`%gs`)

### 15. AppError (`tests/utils/AppError.test.ts`)

Модуль: `src/core/utils/AppError.ts`

- `code` и `data` сохраняются для прокидывания через IPC
- `fallback` идёт в `message`, иначе `message = code`
- `data` по умолчанию — пустой объект
- Наследует `Error` → ловится в catch-блоках, `name === 'AppError'`

### 16. GitActivityStore (`tests/activity/GitActivityStore.test.ts`)

Модуль: `src/core/activity/GitActivityStore.ts`

- `start(operation, repoPath)` создаёт running-entry с `repoPath` (рендерер фильтрует по нему)
- `appendCommand` для несуществующего id — no-op (не throw)
- `finish` ставит status `success`/`error` и `finishedAt`
- `clear` эмитит `cleared` событие; `subscribe` возвращает unsubscribe
- Newest first (unshift), кэп 100 entries
- Обрезка stdout/stderr > 16 KiB до OUTPUT_CAP_BYTES с маркером `[truncated...]`

### 17. ipc/helpers (`tests/bridge/helpers.test.ts`)

Модуль: `src/core/bridge/ipc/helpers.ts`

- **Главный инвариант**: `op` снимает `repoPath` ДО старта операции; переключение вкладки между `operationStart` и `operationEnd` не меняет `repoPath` в end-евенте (это и фиксит «другая вкладка впала в ожидание»)
- `op` пробрасывает `error` от результата в end-евент
- `op` корректно работает с пустым `repoPath` (clone до `openRepo`)
- `opWithPostMerge` шлёт `mergeState` после `operationEnd`
- `errOnFail` шлёт `error`-евент только при `success = false`
- `mergeStateAfter` всегда шлёт `mergeState`
- `runTracked` пишет в `gitActivityStore` (start + finish), включая `error` при throw

### 18. Logger (`tests/utils/Logger.test.ts`)

Модуль: `src/core/utils/Logger.ts`

- Уровни `silent`/`error`/`warn`/`info`/`debug` корректно фильтруют сообщения
- ERROR/WARN идут в `console.error` (stderr), DEBUG/INFO — в `console.log` (stdout)
- Префикс + время + тэг (`[T] HH:MM:SS WARN: msg`)
- `configureMainLogger({ isProduction: true })` → `silent` (тишина в prod)
- `configureMainLogger({ isProduction: false })` → `debug` (всё видно в dev)
- ENV `SKYFORK_LOG_LEVEL=warn` перебивает дефолт
- Невалидный `SKYFORK_LOG_LEVEL` игнорируется (фолбэк на `isProduction`)

### 19. repoPathGuard (`tests/utils/repoPathGuard.test.ts`)

Модуль: `src/core/utils/repoPathGuard.ts`

- Пустой/не-string путь → `dangerous: true`
- Home directory (текущего пользователя), drive root (`C:\`, `/`), `\Users` корень → `dangerous`
- Windows-системные: `C:\Windows`, `C:\Program Files`, `C:\ProgramData`
- POSIX-системные: `/etc`, `/usr`, `/var`, `/home`, `/Users`
- Обычные проектные пути → `dangerous: false`

---

## Конфигурация Vitest

Файл `vitest.config.ts` в корне проекта:

```ts
import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 10000,
    coverage: {
      provider: 'v8',
      include: ['src/core/**/*.ts'],
      exclude: ['src/core/**/types/**'],
      reporter: ['text', 'text-summary'],
    },
  },
  resolve: {
    alias: {
      '@core': resolve(__dirname, 'src/core'),
    },
  },
});
```

---

## Как добавить новый тест

1. Создай файл в `tests/` с суффиксом `.test.ts`:

```
tests/
  git/MyNewParser.test.ts
```

2. Импортируй тестируемый модуль:

```ts
import { describe, it, expect } from 'vitest';
import { myFunction } from '../../src/core/git/MyNewParser';
```

3. Напиши тесты:

```ts
describe('myFunction', () => {
  it('returns empty for empty input', () => {
    expect(myFunction('')).toEqual([]);
  });

  it('parses valid input', () => {
    const result = myFunction('...');
    expect(result).toHaveLength(1);
    expect(result[0].field).toBe('expected');
  });
});
```

4. Запусти:

```bash
npx vitest run tests/git/MyNewParser.test.ts
```

---

## Советы

- **Тестируй парсеры отдельно от Git.** Парсеры принимают строку и возвращают объект — не нужен реальный репозиторий.
- **Используй `\x00` (NUL)** для полей, разделённых `--format='%H%x00%P%x00...'`.
- **Не мокай Git.** Для менеджеров (BisectManager, WorktreeManager) лучше тестировать контракт интерфейса, а интеграционные тесты — отдельно в реальном repo.
- **i18n-тесты ловят забытые переводы.** Если добавил ключ в `en.ts` — тест упадёт, пока не добавишь его в `ru.ts`.

---

## Покрытие

На данный момент покрыты:

| Слой | Модули | Тестов |
|------|--------|--------|
| Git-парсеры | GitParser, DiffParser, ConflictParser, ReflogParser, BlameParser, SubmoduleParser, FileHistoryParser | ~90 |
| Граф | GraphLayout | ~5 |
| Git-менеджеры | WorktreeManager, GitExecutor (sanitizeArgs), RebaseManager | ~18 |
| Команды | writeCommands, readCommands, ConflictManager | ~32 |
| Утилиты | pathSecurity, repoPathGuard, AppError, Logger | ~40 |
| Safety | OperationQueue, AtomicWrite, OperationJournal | ~23 |
| i18n | Полнота ключей en↔ru, tpl | ~14 |
| Менеджеры | BisectManager, HooksManager, LfsManager (контракты) | ~6 |
| State | StateManager (мульти-репо, isRepoTracked гард), repoSlice | ~10 |
| Services | RepoServicesRegistry (lifecycle, isolation) | ~7 |
| Activity | GitActivityStore (per-repo, кэп, обрезка) | ~13 |
| IPC | messages контракты, ipc/helpers (snapshot repoPath) | ~21 |
| AI | AiConfigStore, AiHandlers, AiService, OpenAiCompatibleProvider, prompts | ~30 |
| **Итого** | **37 файлов** | **347** |

---

## Ручное тестирование новых фич

Для фич, которые требуют реального Git-репозитория (Reflog, Bisect, Hooks, Worktrees, LFS), ручное тестирование:

### Reflog

1. Откройте SkyFork → Репозиторий → Reflog
2. Убедитесь, что таблица показывает историю HEAD (checkout, commit, merge и т.д.)
3. Нажмите SHA — он скопируется в буфер обмена
4. Нажмите "Восстановить" — появится подтверждение, после чего `git reset --hard` до выбранного коммита

### Git Bisect

1. Откройте Репозиторий → Bisect
2. Введите SHA плохого коммита (где баг есть) и хорошего (где его нет)
3. Нажмите "Start" — git переключится на средний коммит
4. Проверьте код и нажмите "Хороший" или "Плохой"
5. Повторяйте до нахождения виновного коммита
6. В любой момент можно нажать "Отмена" для `git bisect reset`

### Git Hooks

1. Откройте Репозиторий → Git Hooks
2. Список показывает хуки из `.git/hooks/` (без `.sample`)
3. Toggle вкл/выкл — переименовывает файл с/без `.disabled`
4. Клик по имени раскрывает содержимое хука

### Подписанные коммиты (GPG/SSH)

1. Настройте подпись: `git config commit.gpgsign true`
2. Сделайте коммит — он появится в графе с бейджем ✓ Signed (зелёный)
3. Бейджи: зелёный = верифицирован (G), оранжевый = ненадёжный (U/X/Y), красный = плохой (B/R)

### Рабочие деревья (Worktrees)

1. Откройте Репозиторий → Рабочие деревья
2. Список показывает основное и дополнительные worktree
3. Нажмите "Добавить" — укажите путь и ветку (или создайте новую)
4. Для удаления — кнопка с подтверждением (основное нельзя удалить)

### Git LFS

1. Убедитесь, что `git lfs` установлен (`git lfs install`)
2. Откройте Репозиторий → Git LFS
3. Статус: показывает, установлен ли LFS
4. Отслеживаемые паттерны: список из `.gitattributes`
5. Добавьте паттерн (например `*.psd`) — он добавится в `.gitattributes`
6. Список файлов: все файлы, управляемые LFS

---

## CI/CD

GitHub Actions workflow в `.github/workflows/ci.yml` запускается на push/PR в `main` и `develop`:

```yaml
# Запуск на ubuntu-latest, windows-latest, macos-latest с Node 20
steps:
  - npm ci                              # Установка зависимостей корня
  - npm ci (src/renderer)               # Установка зависимостей renderer
  - npm run lint                        # ESLint проверка
  - npx tsc -p tsconfig.main.json       # TypeScript (main + core)
  - npx tsc -b (src/renderer)           # TypeScript (renderer)
  - npm test                            # Vitest (347 тестов)
  - npm run build:renderer              # Vite сборка
  - npm run build:main                  # tsc main process
```

`npm test` выполняет `vitest run` — однократный прогон, exit-код 0 при успехе, 1 при ошибках.

### Покрытие

```bash
npm run test:coverage    # Vitest с v8 coverage
```

Конфигурация в `vitest.config.ts` в секции `test.coverage`.
