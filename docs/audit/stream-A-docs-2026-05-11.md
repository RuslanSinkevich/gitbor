# Стрим A — переработка документации (2026-05-11)

> HEAD на момент запуска: `a8878e5`. Финальный verify дал `npm test` —
> 494 теста / 48 файлов (на момент завершения стрима, цифры подменит
> parent-агент через HTML-маркеры).

## Сводка

| Действие | Файлы |
|---|---|
| Удалены дубли строк в таблице «Core Modules» / «Модули core» | `docs/architecture.md`, `docs/ru/architecture.md` |
| Node.js 18+ → Node.js 22+ | `docs/getting-started.md`, `docs/ru/getting-started.md` |
| Жёсткие числа тестов заменены HTML-маркерами `<!-- TESTS_COUNT -->` / `<!-- TESTS_FILES -->` | `README.md`, `docs/ru/README.md`, `docs/contributing.md`, `docs/ru/contributing.md`, `docs/testing.md`, `docs/ru/testing.md` |
| Архив исторических доков с баннером | `docs/audit/archive/refactor-multi-repo-engine.md`, `docs/audit/archive/stream-execution.md` |
| Удалены оригиналы из `docs/ru/` | `docs/ru/refactor-multi-repo-engine.md`, `docs/ru/stream-execution.md` |
| Реструктуризация cross-platform чек-листа: 191 → 42 строки | `docs/cross-platform-checklist.md` |
| Добавлена подсекция «Running release-pack smoke locally» | `BUILD.md`, `docs/ru/BUILD.md` |
| Сверка версий пакетов | без изменений — актуальная документация уже на Electron 40 / Vite 6 / TS 5.9 / chokidar 4 / Vitest 4.1 / Playwright 1.59 / husky 9 + lint-staged 17 / electron-builder 26 |

## Задача 1 — удалённые дубли

`docs/architecture.md` («Core Modules»):

- `gitActivityStore` — удалена строка-дубль из нижней группы (после `QwenWebProvider`). Верхняя строка (~с.65) обогащена деталями нижней: `cap = 100 entries`, `OUTPUT_CAP_BYTES = 16 KiB`, маркер `[truncated...]`.
- `AppError` — удалена строка-дубль из нижней группы; оставлен верхний вариант (он содержит концовку `Replaces "English-only strings that nobody translates"`).
- `Logger` — удалена строка-дубль из нижней группы; оставлен верхний вариант (он подробнее: упоминает миграцию `console.warn/error` в `mainLogger` и единственное исключение в `process.on('unhandledRejection'/'uncaughtException')`).

`docs/ru/architecture.md` («Модули core»):

- `gitActivityStore` — аналогично en, удалена нижняя, верхняя обогащена.
- `AppError` — удалена нижняя.
- `Logger` — удалена нижняя.
- **`WorkerPool`** — дополнительно удалена строка-пустышка `(см. выше) — отдельная строка осталась в группе вспомогательных`. Полная строка с описанием пула осталась в её естественном месте (с.50).

`RepoEventBus` проверен — дублей нет в обоих языках.

## Задача 2 — Node version

| Файл | Было | Стало |
|---|---|---|
| `docs/getting-started.md` | `Node.js 18+` | `Node.js 22+ (matches PR gate; CI matrix runs on Node 20)` |
| `docs/ru/getting-started.md` | `Node.js 18+` | `Node.js 22+ (соответствует PR-гейту; CI matrix крутит на Node 20)` |

В `BUILD.md` / `docs/ru/BUILD.md` уже было `Node.js 22+` — не трогал.

## Задача 3 — TODO-маркеры тестовых чисел

Везде, где были `470` / `46`, стоит:

```
<!-- TESTS_COUNT -->488<!-- /TESTS_COUNT -->
<!-- TESTS_FILES -->48<!-- /TESTS_FILES -->
```

Внутри маркеров — приблизительное число (488/48). Parent-агент после
финального `npm test` подменит на реальное (на момент исполнения этого
стрима — **494/48**).

Места правок:

| Файл | Количество маркеров (count + files на каждое упоминание) |
|---|---|
| `README.md` | 3 (Stack-таблица, tree-комментарий, Status-блок) |
| `docs/ru/README.md` | 3 (Стек-таблица, tree-комментарий, Статус-блок) |
| `docs/contributing.md` | 1 (PR Checklist) |
| `docs/ru/contributing.md` | 1 (Чеклист PR) |
| `docs/testing.md` | 3 (`Coverage Summary` Total-строка, CI-блок ci.yml, pre-push блок) |
| `docs/ru/testing.md` | 4 (Coverage Total-строка, CI-блок ci.yml, pre-push блок, контрольная строка `**470 тестов / 46 файлов — всё зелёное.**` после GitParser) |

В `docs/architecture.md` / `docs/ru/architecture.md` упоминаний чисел
тестов нет — там только структура модулей.

## Задача 4 — Архив

- Создана папка `docs/audit/archive/`.
- `docs/ru/refactor-multi-repo-engine.md` → `docs/audit/archive/refactor-multi-repo-engine.md` (12 614 байт).
- `docs/ru/stream-execution.md` → `docs/audit/archive/stream-execution.md` (10 985 байт).
- В верхнюю строку каждого добавлен баннер:

> Архивный документ. Стрим исполнен. Актуальное состояние — docs/architecture.md.

- Оригиналы удалены через `Delete`.
- Внутри `stream-execution.md` исправлена внутренняя ссылка
  `docs/ru/refactor-multi-repo-engine.md` → `refactor-multi-repo-engine.md`
  (теперь сосед по папке).
- Grep по актуальной документации (`README.md`, `BUILD.md`,
  `docs/*.md`, `docs/ru/*.md`) на `refactor-multi-repo-engine` /
  `stream-execution` — пусто. Единственное совпадение —
  `docs/audit/audit-2026-05-08.md`, который трогать запрещено хард-правилами.

## Задача 5 — Реструктуризация cross-platform-checklist.md

Было 191 строка → стало **42** строки.

Удалено: все пункты со статусом «закрыто (стрим N)» (стримы 3 и 4)
вместе с раскрывающими подробностями (entitlements XML, NSIS, env-
переменные для DMG-нотаризации, исправление `repoPathGuard` и т. д.).

Оставлено:

- Структурная преамбула (что это и где смотреть закрытые пункты).
- Открытые пункты по платформам (таблица с приоритетом).
- Раздел «Что вне scope» (Apple Developer ID, bundled git,
  cross-build из CI).
- Раздел «Что проверить вручную на mac/linux».
- Раздел «Связанные исторические отчёты» со ссылками на
  `cross-platform-2026-05-09-3.md`, `cross-platform-2026-05-10.md`,
  `hardening-2026-05-09-2.md`.

`docs/ru/cross-platform-checklist.md` не существовал — НЕ создавал
(в задании прямо указано не создавать, если файла нет).

## Задача 6 — Release-pack секция

В `BUILD.md` и `docs/ru/BUILD.md` после строки про `release-pack.yml` в
секции `## CI` вставлена подсекция `### Running release-pack smoke
locally` (en) / `### Локальный запуск release-pack smoke` (ru). Включает:

1. Запуск через `gh workflow run "Release Pack Smoke" --ref main`.
2. Альтернатива — добавить label `release-smoke` к открытому PR.
3. Где смотреть артефакты: Actions → run → раздел Artifacts (retention
   7 дней). Имена: `skyfork-Windows-unpacked`, `skyfork-macOS-unpacked`,
   `skyfork-Linux-unpacked`.
4. Что проверять: архив распаковывается, бинарь на месте
   (`skyfork.exe` / `SkyFork.app/Contents/MacOS/SkyFork` / `skyfork`).
   Запуск UI в smoke не входит — валидируется только pipeline.

## Задача 7 — Версии пакетов

Полный grep по актуальной документации (`README.md`, `BUILD.md`,
`docs/*.md`, `docs/ru/*.md`) на старые версии:

- `Electron 32`/`Electron 28` — нет.
- `Vite 5` — нет.
- `TypeScript 5.3` — нет.
- `chokidar 3` — нет.
- `Vitest 3`/`Vitest 2` — нет.
- `electron-builder 24` — нет.
- `Playwright 1.5[0-8]` — нет.
- `husky 8` / `lint-staged 1[4-6]` — нет.

Все упоминания версий в актуальной документации уже соответствуют
финальному стейту (Electron 40, Vite 6, TS 5.9, chokidar 4,
Vitest 4.1, Playwright 1.59, husky 9 + lint-staged 17,
electron-builder 26). Правки не требовались.

Единственные совпадения по старым версиям (`chokidar 3 → 4`,
`electron-builder 24 → 26`) — в исторических audit-доках
`docs/audit/upgrade-2026-05-09.md` (записи об апгрейде); они вне scope.

## Задача 8 — Финальный verify

| Проверка | Результат |
|---|---|
| `npm test` | `Test Files 48 passed (48)`, `Tests 494 passed (494)`, длительность 3.58s, exit 0 |
| `npx tsc -p tsconfig.main.json --noEmit` | exit 0, нет вывода |
| `npm run build` | renderer + main собрались, exit 0, размер renderer js — 340.55 KB (gzip 104.01 KB) |
| `grep "470"` по `README.md`+`docs/*.md` | пусто (совпадения только в исторических `docs/audit/*.md`, вне scope) |
| `grep "Node.js 18"` по scope | пусто |
| `grep "refactor-multi-repo-engine" / "stream-execution"` по актуальной документации | пусто (только `docs/audit/archive/stream-execution.md` — это сам архивный файл, и `docs/audit/audit-2026-05-08.md` — исторический доку, вне scope) |
| Структура таблиц `architecture.md` после удаления дублей | целостна: ровно одна строка на каждый модуль, разделители на месте |

Чёткий рассинхрон с заданием: задание упоминало 483/47 как
baseline → 488-491/48 после стрима C. На момент запуска
verify уже было 494/48 — стрим C добавил больше тестов, чем
оценивалось в задании. На итоговую механику маркеров это не
влияет: parent-агент подменит цифры на реальные.

## Что НЕ сделал

- `docs/ru/cross-platform-checklist.md` — не создан (его не было, в
  задании прямо указано «не создавай»).
- Ссылки на `refactor-multi-repo-engine` / `stream-execution` в
  `docs/audit/audit-2026-05-08.md` — не правил (хард-запрет на
  исторические audit-доки).
- Старые версии пакетов (`chokidar 3 → 4` и `electron-builder 24 → 26`)
  в `docs/audit/upgrade-2026-05-09.md` — не правил, это исторический
  отчёт об апгрейде, упоминание старых версий там семантически уместно
  (и сам файл вне scope).

## Принятые самостоятельно решения

1. **Маркеры с числом 488/48 внутри**. В задании дан диапазон 488-491
   как «после стрима C». Выбрал минимальное число (488), parent-агент
   всё равно подменит на реальное.
2. **Слияние дублей gitActivityStore**: вместо удаления одной из двух
   строк, верхнюю в `Core Modules` обогатил недостающими деталями из
   нижней (`cap = 100 entries`, `OUTPUT_CAP_BYTES = 16 KiB`,
   `[truncated...]` marker) — иначе детали потерялись бы.
3. **Внутренняя ссылка в архивном `stream-execution.md`**: ссылка
   `docs/ru/refactor-multi-repo-engine.md` исправлена на
   `refactor-multi-repo-engine.md` (теперь файлы лежат в одной папке).
   Не считал нарушением scope — это правка внутри только что созданного
   мной архивного файла.
4. **Реструктуризация cross-platform-checklist.md**: получилось 42
   строки вместо «50-70» из задания. Не стал искусственно раздувать
   текст: чем компактнее живой документ, тем легче поддерживать.
5. **Node version preamble**: в `getting-started.md` добавил пояснение
   `(matches PR gate; CI matrix runs on Node 20)` чтобы устранить
   путаницу читателя «почему в одном месте Node 22, в другом Node 20».
   Источник правды — `README.md`, остальные доки на него выровнены.

## Файлы, изменённые в стриме

- `README.md`
- `BUILD.md`
- `docs/getting-started.md`
- `docs/architecture.md`
- `docs/contributing.md`
- `docs/testing.md`
- `docs/cross-platform-checklist.md` (полностью переписан)
- `docs/ru/README.md`
- `docs/ru/BUILD.md`
- `docs/ru/getting-started.md`
- `docs/ru/architecture.md`
- `docs/ru/contributing.md`
- `docs/ru/testing.md`
- **Удалены:** `docs/ru/refactor-multi-repo-engine.md`, `docs/ru/stream-execution.md`
- **Созданы:** `docs/audit/archive/refactor-multi-repo-engine.md`, `docs/audit/archive/stream-execution.md`, `docs/audit/stream-A-docs-2026-05-11.md`

`docs/features.md`, `docs/ru/features.md` — не трогал (никаких задач
по этим файлам в скоупе не было).
