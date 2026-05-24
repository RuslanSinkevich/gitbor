# Auto-update: аудит сложности и prod

## Проблема

GitBor раздаётся вручную. Нужен auto-update с **Yandex Object Storage** (не GitHub — риск блокировки в РФ).

В репозитории уже есть **черновик** интеграции `electron-updater`. End-to-end с бакетом **не проверен**. Возможен перегиб: лишние слои (main + IPC + renderer + отдельный hook + несколько event types) там, где хватило бы проще.

### Предположительно не так

- Релизный цикл (dist → upload → version bump) не зафиксирован
- Первая версия **с** updater у юзеров **без** updater — непроработанный переход
- Windows: NSIS vs portable — разное поведение, легко перепутать
- Сложность решения может быть **выше задачи** для solo / малой аудитории

## Цель

**Windows NSIS:** установленная версия сама находит update на Yandex, скачивает, предлагает перезапуск.

**Код:** не «допилить всё подряд», а **оценить сложность** — если переусложнено, **сократить** до минимума, который закрывает цель. Рабочий prod-цикл релиза понятен.

## Для исполнителя (мощная модель)

1. **Сначала аудит** — прочитать весь update-related код в репо, не опираясь на описания в этом файле.
2. **Оценить сложность:** сколько moving parts, нужны ли все (IPC events, отдельный handler file, hook в App, manual vs auto paths)?
3. **Если over-engineered** — упростить (меньше файлов/событий/абстракций), не теряя цель.
4. **Если достаточно просто** — только fix дыр и e2e проверка.
5. UI-строки — только i18n, не main process.

## Scope

- Весь код и конфиг, связанный с app auto-update
- Yandex bucket + `build.publish`
- E2E: NSIS vN → `latest.yml` vN+1 → download → restart
- About / ручная проверка, ru/en
- Dev, portable, недоступный бакет — без crash
- Findings: что убрали как лишнее / что оставили и почему

## Критерии готовности

- Есть краткий verdict: **«была переусложнена / норм»** + что изменили
- NSIS: update с Yandex работает end-to-end
- Бакет 404/пустой — приложение живёт
- Диалоги на языке UI
- Меньше или столько же кода, сколько было — **не больше** без обоснования
- `docs/ru/BUILD.md` актуален по релизному циклу (кратко)

## Вне scope

- macOS / Linux auto-update
- CI upload в Yandex
- Code signing
- Auto-bump version при dist

## Связано

- `docs/ru/BUILD.md`
- Yandex bucket `gitbor`
- `electron-updater`, `electron-builder` (NSIS)
