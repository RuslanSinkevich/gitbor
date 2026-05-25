# Diff + stat-dirty: пути с пробелами и кавычками

## Проблема

В GitBor файлы с **пробелами в пути** (например `dbo/Stored Procedures/file.sql`) попадали в список локальных изменений, но при клике diff не показывался — **«Нет diff»**. Fork на том же репо diff показывал нормально.

Дополнительно такие файлы отображались **серыми** (stat-dirty): иконка `·`, пониженная opacity, tooltip «нет реальных изменений». При этом изменения были реальные (контент менялся, не только mtime).

В дереве файлов иногда видны **лишние кавычки** в именах: папка `"database`, файл `file.sql"` — путь в UI хранился с git-кавычками внутри строки.

### Корень

1. `git status --porcelain` иногда отдаёт путь в C-style quoting: `"dir with spaces/file.sql"`. `parseStatus` брал `line.slice(3)` как есть → кавычки оставались в `FileStatus.path`.

2. `git diff -- "<path с кавычками>"` не находил файл на диске → пустой stdout → UI «Нет diff».

3. `RepoStateRefresher.detectStatDirtyPaths`: если путь из status не совпал с выводом `git diff --numstat`, срабатывал fallback «файла нет в numstat → stat-dirty». Ложное срабатывание на файлах с реальными изменениями.

4. Отдельный риск (не воспроизведён на том репо, но закрыт): `diff.external` в конфиге репо → git отдаёт не unified diff → `parseDiff` возвращает `[]`.

Тип файла (`.sql`, stored procedure и т.д.) **не при чём** — ломается любой путь с пробелами/quoting.

## Что сделано (v0.1.4)

| Файл | Изменение |
|------|-----------|
| `src/core/git/GitParser.ts` | `unquoteGitPath()` — снимает `"..."` и базовые escape-последовательности; вызывается в `parseStatus` для каждого пути |
| `src/core/state/RepoStateRefresher.ts` | stat-dirty только при явном `0\t0` в numstat; убран fallback «path не в выводе → dirty» |
| `src/core/commands/readCommands.ts` | ко всем `git diff` в `getFileDiff` добавлены `--no-ext-diff`, `--no-textconv`, `--no-color` |
| `tests/git/GitParser.test.ts` | тесты на `unquoteGitPath` и quoted path в `parseStatus` |

Версия релиза: **0.1.4** (`package.json`, `src/renderer/package.json`).

## Контекст для проверки

Репо, где баг проявился: пути вида `database/.../Stored Procedures/*.sql`, unstaged `M`, Fork показывает diff (пример: `nvarchar(50)` → `nvarchar(250)`).

Ожидаемое поведение после фикса: обычный статус `M` (не серый), diff с hunks, имена в дереве без `"` на краях.

## Связано

- `src/renderer/src/features/diff/DiffPanel.tsx` — «Нет diff» при `diffs.length === 0`
- `src/renderer/src/features/changes/FileTree.tsx` — серый = `file.statDirty === true`
- коммит stat-dirty фичи: `c7b057e` (там появился агрессивный numstat-fallback)
