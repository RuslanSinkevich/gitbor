# Задача: пересмотреть систему оповещений об ошибках по уровню важности

> Стартовый промпт для нового агентского таба. Скопируй в новый чат.

---

## Проблема

Сейчас любая ошибка git попадает в renderer как «error» одинаковой громкости:

- `useOperationToasts` показывает красный toast;
- запись в журнале git-активности получает `status: 'failed'` → красная плашка;
- для классов из `HIDDEN_BY_DIALOG` ещё и открывается SafetyDialog по центру.

Из-за этого фоновые ошибки сети пугают так же, как если бы юзер сам что-то сломал. Конкретный кейс:

> Юзер выключил VPN. Через 5 минут `useAutoFetch` дёрнул `git fetch` к недоступному remote. В журнале — красная запись «fetch failed: unable to access...». Юзер ничего не делал, ничего не сломалось — но визуально это выглядит как авария.

Это не баг классификатора (`network` он определяет корректно). Это баг **политики показа**: фоновая операция = фоновый шум, а не сигнал тревоги.

## Диагноз

В коде смешаны два ортогональных понятия:

1. **Класс ошибки** (`GitErrorClass`: `network`, `auth`, `conflict`, `lock_held`, ...) — что случилось технически.
2. **Severity** (важность для юзера) — насколько громко об этом орать.

Severity сейчас выводится из класса по неявным правилам в нескольких местах (`useOperationToasts`, `useSafetyDialog`, GitActivity-индикатор), без единого источника правды. И **источник операции** (user-initiated vs background) вообще нигде не учитывается, хотя это главный фактор.

## Цель

Ввести трёхуровневую систему severity и **разделить user vs background источники**. Громкость показа — функция от пары `(severity, source)`. SafetyDialog по центру — только для уровня `critical`. Фоновые сетевые ошибки — `info`, не `error`.

## Сценарии-кандидаты на ложно-громкие ошибки

Не только описанный кейс с VPN — это симптом большего класса проблем. Полный список того что нужно проверить и правильно отклассифицировать:

### Фоновые операции (source = background)

1. **Авто-fetch при отвалившемся VPN** (исходный кейс). `network` → `info`, тихая запись в журнале.
2. **Авто-fetch при истёкшем токене / разлогиненном кредхелпере**. `auth` от фоновой операции — `warning`, мягкий info-toast «не получается достучаться до remote-X, проверь auth», не модал. Сейчас раз в 5 минут юзер будет получать модал на каждое repo с auth-проблемой.
3. **Авто-fetch через прокси с TLS-сертификатом MITM**. `network` (SSL_ERROR) → `info` от фона. У юзера однотипная ошибка постоянно — она не должна спамить.
4. **FileWatcher триггерит refresh, git внутри `status` падает на dirty index** (например юзер в этот момент сам делал `git add` в внешнем терминале). Это `lock_held` от фона → молча подождать и ретраить, юзер ничего не должен видеть.
5. **RepoStateRefresher гоняет периодический refresh** при свёрнутом окне (по дизайну не должен, см. `useWindowVisible`, но проверить). Любая ошибка тут — `info` максимум.
6. **Авто-refresh после внешнего изменения (terminal git checkout снаружи)** — может временно поймать рассогласование state. Не алармить.
7. **Submodule update в фоне** (если он есть как часть pull autostash flow). `network` / `auth` на submodule — `warning`, не модал.
8. **LFS smudge/pull в фоне** при checkout — `network` ошибка тяги binary-файла. Файл просто будет в pointer-state, операция чекаута уже прошла. → `warning`, не критично.
9. **Hooks падают** (`pre-commit`, `commit-msg`, `pre-push`). Это не наша ошибка, а ошибка юзерского скрипта. Сейчас попадёт в `unknown` → critical → модал. Нужен **отдельный класс `hook_failed`** с severity `warning` и показом stdout/stderr хука в специальном toast (не модал!) с кнопкой «открыть hooks dialog».
10. **GPG signing failed** при commit (нет ключа, секретница залочена). Сейчас тоже `unknown` → модал. Новый класс `gpg_failed`, severity `warning`, toast с подсказкой «открой настройки GPG».

### User-инициированные, но не критичные

11. **Push с `non_fast_forward`** — сейчас warning по карте, но в коде попадает в SafetyDialog. Перепроверить: должен быть warning-toast «remote ahead, pull first» с действием «Pull & retry».
12. **`branch -d unmerged`** — git отказывается, юзер видит ошибку. Это ожидаемо. Toast warning «branch not merged, use force delete?» с действием. Не модал.
13. **`tag -d` несуществующего тега** — `unknown` → модал. Должен быть info-toast «tag not found».
14. **`stash pop` когда stash пустой** — то же. Info-toast «no stash to pop».
15. **`remote add` с уже существующим именем** — warning toast «remote already exists».

Это всё операции из `SILENT_OPS` в `useOperationToasts`, которые сейчас на success молчат, но **на error всё равно показывают красный toast**. Логика «silent» должна работать в обе стороны: тихий успех = тихая ошибка низкого severity.

### Транзитные / самоустраняющиеся

16. **`lock_held` после safety-relaxation lock-waiter** — если waiter всё-таки сдался, но в момент показа модала lock уже исчез (гонка). Перед открытием модала — повторить проверку. Если lock'а нет — операцию ретраить молча.
17. **Сетевой блип** (один проваленный fetch, через 5 минут следующий успешный). Никакой реакции в UI вообще — только в журнале короткая серая запись.

### Multi-repo массовые сбои (отдельный жанр)

18. **Autofetch на N открытых репо, у всех общий remote-хост лежит.** Сейчас (подтверждено скриншотом): четыре `network` ошибки склеиваются в один длинный toast вида `fatal: unable to access X ... fatal: unable to access Y ... fatal: unable to access Z ... fatal: unable to access W` с кнопкой «Повторить», которая ретраит только последнюю операцию (или вообще ничего полезного). Юзер видит простыню красного текста на пол-экрана, ничего понять нельзя, действие невозможно.

    **Корень:** toast'ы агрегируются по таймауту или по общему ключу, но без аккумулирования смысла. Текст склеивается, action — нет.

    **Правильное поведение:**
    - **Аггрегация по `(errorClass, host)`** в окне 10 секунд: 4 фейла fetch'а к `tfs.suek.ru` за минуту → один info-toast «4 repos: cannot reach tfs.suek.ru», без перечисления каждого URL.
    - Действие на таком aggregated toast — **«Show details»** (открыть журнал git-активности с фильтром по этим записям), не «Retry» (ретраить пакетно бессмысленно — host лежит).
    - В журнале каждая из 4 ошибок — отдельной серой строкой, чтобы юзер мог посмотреть какие именно репо упали.
    - Если все 4 — `source: background`, severity = `info` → этого aggregated toast'а **вообще нет** в активном UI. Только запись в журнале с агрегированным заголовком «4 repos affected by network issue with tfs.suek.ru».

### Ложно-тихие (обратная проблема — где надо громче)

Эти сейчас могут проходить незамеченными, severity-система должна это поднять:

18. **`hook_failed` для `pre-push`** — push **не** ушёл, юзер думает что ушёл. Сейчас в SILENT_OPS push нет, но это ок; проверить что хук-фейл реально виден.
19. **`gpg_failed` для commit** — commit **не** создан. Сейчас может проскочить как «фоновая ошибка». Должно быть `warning` + явный toast с действием.
20. **`disk_full` / `no_space_left`** — нет такого класса. Любая git-операция ловит обычно `fatal: cannot write ... no space left on device`. Это **критично** для пользовательских данных. Добавить класс, severity = `critical` всегда, модал с инструкцией.
21. **Repo corruption** (`fatal: bad object`, `fatal: object file is empty`, `fatal: loose object ... is corrupt`). Сейчас `unknown`. Добавить класс `repo_corrupt`, severity = `critical`, **немедленно показывать модал с инструкцией** (git fsck, recovery из reflog). Это редко, но проигнорировать = потеря данных.
22. **Detached HEAD после `checkout <hash>`** — это не ошибка, но юзер может не понять что произошло. Нужен info-toast «You are now in detached HEAD state» с действием «Create branch from here». Это уже скорее UX, но укладывается в систему уведомлений.

## Что добавить в классификатор

Новые классы `GitErrorClass`:

- `hook_failed` — паттерн `/hook (declined|failed)|pre-commit hook failed|pre-push hook failed|commit-msg hook failed/i`;
- `gpg_failed` — паттерн `/gpg failed to sign|secret key not available|gpg: signing failed/i`;
- `disk_full` — паттерн `/no space left on device|disk quota exceeded|cannot write.*disk/i`;
- `repo_corrupt` — паттерн `/bad object|object file .* is empty|loose object .* is corrupt|fsck/i`;
- `branch_unmerged` — паттерн `/branch .+ is not fully merged/i` (для warning-toast с force-delete action);
- `tag_not_found` / `branch_not_found` / `stash_empty` — паттерны для info-toast'ов вместо unknown;
- `proxy_tls` — подкласс `network` для отдельного hint про MITM/прокси.

## Архитектура

### 1. Поле `source` на каждой операции

В `RendererCommand` (или в meta операции в queue) добавить:

```ts
type OperationSource = 'user' | 'background' | 'auto-retry';
```

- `user` — юзер сам нажал кнопку или Hotkey;
- `background` — autofetch, polling, watcher-triggered refresh, прогрев кэша;
- `auto-retry` — наш собственный ретрай после lock_waiter / network bounce.

`postCommand` в renderer по умолчанию ставит `user`. `useAutoFetch` и подобные явно ставят `background`.

### 2. Поле `severity` на классифицированной ошибке

В `ClassifiedError` добавить:

```ts
type ErrorSeverity = 'critical' | 'warning' | 'info';
```

Базовая карта `GitErrorClass → ErrorSeverity`:

| Класс                       | Severity   | Комментарий |
|----------------------------|-----------|-------------|
| `conflict`                 | warning   | ожидаемое состояние, не авария |
| `dirty_tree`               | warning   | юзер должен разобраться, но это норма |
| `untracked_overwrite`      | warning   | то же |
| `merge_in_progress`        | warning   | сессия активна, не сломано |
| `rebase_in_progress`       | warning   | |
| `cherry_pick_in_progress`  | warning   | |
| `revert_in_progress`       | warning   | |
| `unmerged_paths`           | warning   | |
| `non_fast_forward`         | warning   | |
| `lock_held`                | warning   | после lock_waiter из safety-relaxation |
| `network`                  | info      | временно нет связи — не катастрофа |
| `auth`                     | warning   | требует действия, но не критично |
| `preflight_blocked`        | warning   | |
| `hook_failed`              | warning   | юзерский скрипт упал, нужен показ stderr |
| `gpg_failed`               | warning   | подсказка про настройки GPG |
| `branch_unmerged`          | warning   | toast с предложением force-delete |
| `tag_not_found`            | info      | мелочь, info-toast |
| `branch_not_found`         | info      | то же |
| `stash_empty`              | info      | то же |
| `proxy_tls`                | warning   | редко, нужен hint про прокси/MITM |
| `disk_full`                | critical  | реальная опасность данным — модал |
| `repo_corrupt`             | critical  | потенциальная потеря данных — модал |
| `unknown`                  | critical  | мы не знаем что произошло — модал |

Это **дефолт**. Финальный severity вычисляется с поправкой на source — см. ниже.

### 3. Матрица «как показывать»

| source \ severity | info                      | warning                       | critical                      |
|------------------|---------------------------|-------------------------------|-------------------------------|
| `user`           | toast info, 3 сек         | toast warning + действие      | модал SafetyDialog            |
| `background`     | **молча в журнал**        | toast info (мягкий), 3 сек    | toast warning + действие      |
| `auto-retry`     | молча в журнал            | молча в журнал (debug)        | toast warning + действие      |

Ключевое:

- **background + info = ничего не показываем поверх UI**. Только тихая пометка в журнале (см. п.4).
- **background + warning** = info-toast (синий, не красный). Пример: фоновый autofetch упал по auth — стоит уведомить, но не алармить.
- **critical в любом источнике** = громко (либо модал, либо warning-toast с retry).
- Модал по центру **только** для `critical` и **только** для `user`-операций. Фоновые операции никогда не открывают модалов.

### 4. Журнал git-активности

В `GitActivityEntry` сейчас `status: 'running' | 'success' | 'failed'`. Расширить:

```ts
status: 'running' | 'success' | 'completed_with_warning' | 'failed'
severity?: 'info' | 'warning' | 'critical'
source: OperationSource
```

Цветовая логика в журнале:

- `success` → зелёный/нейтральный;
- `completed_with_warning` (success: false, severity ≤ warning, source: background) → серый/нейтральный, иконка info; **не красный**;
- `failed` (severity: critical OR source: user) → жёлтый для warning, красный для critical.

Дополнительно: фильтр по source в журнале — «показывать только мои операции / показывать всё». По умолчанию — всё, но **фоновые info-ошибки скрывать одним кликом**.

### 5. SafetyDialog

Открывается **только** когда: `source === 'user' && severity === 'critical'`. Все остальные пути — через toast.

Это срежет 80% случаев, когда сейчас модал лезет на ровном месте (например `network` от autofetch).

### 6. Авто-fetch — отдельный backoff на ошибках

Поверх severity-системы:

- `useAutoFetch` при `network`-ошибке **увеличивает интервал**: 5 мин → 15 мин → 30 мин → 60 мин (cap);
- при первом успешном fetch сбрасывает обратно на 5 мин;
- юзер не должен видеть, что мы перешли в режим «сеть лежит, ждём». Только если 4 неудачных подряд — показываем мягкий info-toast «autofetch paused: network unavailable, will retry every 60 min» с кнопкой «retry now».

Это не «прятать ошибку», это адаптация частоты под реальность.

## Что сделать

### Бэкенд

1. Добавить `OperationSource` и проложить через всю цепочку: `postCommand` → IPC → `CommandHandler` → `OperationQueue` → `SafetyNet.wrapDestructive` → `OperationResult`. Для операций инициированных не из renderer (autofetch, FileWatcher refresh, RepoStateRefresher) — `source: 'background'` ставится в месте вызова в main-процессе.
2. Добавить `ErrorSeverity` в `ClassifiedError`. Базовый маппер `classToSeverity(class, source)` — pure function.
3. Расширить `GitErrorClassifier` новыми классами (`hook_failed`, `gpg_failed`, `disk_full`, `repo_corrupt`, `branch_unmerged`, `tag_not_found`, `branch_not_found`, `stash_empty`, `proxy_tls`). Порядок паттернов: специфичные новые классы — **выше** `unknown` и выше общего `network`. Тесты на каждый класс по реальным stderr-сэмплам.
4. Для `hook_failed`: сохранить полный stdout+stderr хука отдельным полем `hookOutput?: string` в `OperationResult`, чтобы UI показал его юзеру (не первые 200 символов общего stderr, как сейчас).
5. `wrapDestructive` возвращает не только `errorClass`, но и `severity` уже с учётом source.

### Renderer

4. `useOperationToasts` переписать на матрицу `(source, severity)`. Удалить хардкод «network/auth → красный toast с retry».
5. `useSafetyDialog`: открывать модал только при `severity === 'critical' && source === 'user'`.
6. `useGitActivity`: добавить `severity` и `source` в entries, обновить рендер строк (цвет, иконка).
7. Фильтр в `GitActivityDialog` по source/severity (минимум — чекбокс «hide background info»).
8. **Аггрегатор однотипных ошибок.** Новый модуль `useErrorAggregator` (или встроить в `useOperationToasts`):
   - буфер на 10 секунд;
   - ключ агрегации = `(errorClass, host)` для network/auth ошибок, `(errorClass)` для остальных;
   - host вычисляется из stderr через regex по `https?://[^/\s]+` / `git@[^:]+`;
   - если в окне 10 сек прилетело ≥2 ошибки с одним ключом — показывать **один** aggregated toast вида `«N repos: <короткое описание класса> with <host>»`;
   - action на aggregated = **«Show details»** (открыть GitActivityDialog с фильтром по этим записям), НЕ «Retry» (бессмысленно для одного хоста на 4 репо);
   - если хотя бы одна из агрегированных = `source: user` → severity aggregated повышается до уровня самой громкой в группе. Если все = `background` → severity по правилам матрицы (для `network info` — вообще не показываем toast, только запись в журнале).
   - **запрещено склеивать stderr в один длинный текст.** Длина aggregated toast — максимум одна строка.

### useAutoFetch

8. Адаптивный backoff на network-ошибках (5/15/30/60 мин с cap).
9. После 4 фейлов подряд — единичный мягкий toast.

### i18n

10. Новые строки: `autoFetch.paused`, `autoFetch.retryNow`, `errors.network.info` («Нет связи с удалённым репозиторием») и т.п.

### Тесты

11. Unit для `classToSeverity`.
12. Unit для матрицы показа `(source, severity) → action`.
13. Smoke: имитировать `network` ошибку в фоне → проверить что нет красного toast, есть запись в журнале с серой иконкой.

## Не делать

- Не вводить юзер-настройку «полностью отключить ошибки» — приведёт к молчаливым сломам.
- Не делать кастомный «уровень шума» в Settings на первой итерации — сначала пусть работает дефолт, потом по фидбэку.
- Не трогать классификатор паттернов — он не виноват.
- Не переделывать визуал toast — только тип (info/warning/error) меняем.

## Метрики приёмки

Базовые:

- VPN отключён, autofetch отработал → 0 красных toast, в журнале серая запись «fetch: network unavailable»;
- юзер сам жмёт push при отключённом VPN → жёлтый toast с retry, **не модал**;
- юзер жмёт checkout, у git внутренняя ошибка `unknown` → модал по центру (это критично, мы не знаем что);
- 10 autofetch-ошибок подряд на дохлом remote → 1 info-toast после 4-й, дальше тихо.

Расширенные (по новым классам):

- `pre-commit` хук с `exit 1` → warning-toast с превью stderr, **не модал**;
- `commit` без настроенного GPG (при `commit.gpgsign=true`) → warning-toast «GPG signing failed» с действием «Open GPG settings»;
- `branch -d feature/x` с unmerged → warning-toast «branch not fully merged» с действием «Force delete»;
- `stash pop` пустой стэк → info-toast «no stash to pop», тихо;
- `tag -d nonexistent` → info-toast, тихо;
- `commit` при заполненном диске → **модал** «no space left on device» с инструкцией;
- `git status` который вернул `bad object` → **модал** «repository may be corrupt» с инструкцией про `git fsck`;
- FileWatcher триггерит refresh, git внутри ловит `lock_held` → молча ретраит, ноль visible-сигналов;
- три fetch подряд за минуту, второй упал по network, третий ок → в журнале только короткая серая запись о втором, никаких toast.

Multi-repo сценарии:

- открыто 4 репо с общим remote-хостом, хост лёг, autofetch отработал по всем 4 → **0 toast'ов** (все background+info), в журнале 4 серых строки + одна агрегированная заголовочная;
- открыто 4 репо, юзер сам жмёт push сразу в трёх (через переключение табов) при дохлом хосте → **1 aggregated warning-toast** «3 repos: cannot push to <host>» с action «Show details», НЕ три отдельных красных toast'а;
- aggregated toast никогда не содержит склеенного stderr (нет простыни «fatal: unable to access X ... fatal: unable to access Y»);
- ширина aggregated toast = одна строка, длина текста ≤ 80 символов.

## Связано

- `docs/tasks/safety-relaxation.md` — после неё `lock_held` уходит из критичных вообще, см. перенос в `warning`.
- Старая `docs/safety-error-handling.md` (post-mortem уже сделанной задачи) описывает текущую модель; этот таск её эволюционирует.

## Запуск

Реализуй задачу из `docs/tasks/error-severity-system.md`. Делай в порядке: source через пайплайн → severity → матрица показа → autofetch backoff → тесты. Без лишних вопросов.
