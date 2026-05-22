# Задача: унификация диалогов через SgDialog (UI-kit аудит)

> Стартовый промпт для нового агентского таба. Скопируй в новый чат.

---

## Проблема

UI-kit задуман и частично работает (`src/renderer/src/ui/SgDialog.tsx` поверх нативного `<dialog>` с focus-trap и `aria-modal`), но большинство feature-диалогов написано до него или в обход. Каждый со своим `.overlay` CSS, своим Esc-обработчиком, своим focus-trap (или без него).

Визуально похоже благодаря CSS-переменным `--sg-*`, но код и a11y разъехались. При изменении правил оформления модалок (тени, отступы, ширина, motion) — менять придётся в 14+ файлах.

## Текущее состояние

Использует `SgDialog`:
- `AboutDialog`, `SshKeysDialog`, `BisectDialog`, `HooksDialog`, `LfsDialog`, `WorktreesDialog`, `MergeDialog`, `RepoSettingsDialog`, `AiSettingsDialog`, `StatisticsDialog`, `ReflogDialog`, `GitignoreDialog`.

Свой overlay/dialog (НЕ через SgDialog):
- `SafetyDialog` (`features/safety/SafetyDialog.tsx` + `.module.css`);
- `SgPromptDialog` (`ui/SgPromptDialog.tsx`) — должен использовать SgDialog внутри;
- `GitActivityDialog` (`features/git-activity/GitActivityDialog.tsx`);
- ряд CSS-файлов с `.overlay` который уже не нужен (`AboutDialog.module.css`, `WorktreesDialog.module.css` и т.д. — наследие старого подхода).

## Цель

Один способ открыть модал — `SgDialog`. Один источник правды для overlay, focus-trap, Esc, размеров. CSS-классы `.overlay` в feature-папках удалены.

## Что сделать

### 1. Аудит и список

Пройтись по всем `*Dialog*.tsx` в `src/renderer/src/features/**` и `src/renderer/src/ui/**`. Для каждого:
- использует ли `SgDialog`;
- если нет — почему (особая структура, нужна доп. фича);
- какие `.overlay`-стили нужно удалить.

Записать сводку в комментарий PR (или в `docs/audit/dialogs-unification-<date>.md`).

### 2. Расширить SgDialog

Сейчас `SgDialog` минимален: title, body, footer, width. Не хватает того, что заставляет feature-команды писать своё:

- `size?: 'sm' | 'md' | 'lg' | 'xl' | 'fullscreen'` — пресеты ширины + max-height;
- `noPadding?: boolean` — для диалогов с табами/листами по краям;
- `headerExtra?: ReactNode` — кнопка в шапке справа (например, settings-cog);
- `onConfirm?: () => void` + `confirmLabel`, `confirmDisabled`, `confirmDanger` — стандартный footer Cancel/Confirm, чтобы не дублировать в 12 местах;
- `aria-describedby` для опционального описания;
- проп `initialFocus?: 'firstInput' | 'confirm' | RefObject` (сейчас фокус остаётся на triggering element до взаимодействия).

### 3. Мигрировать диалоги

Кандидаты на миграцию:
- **`SgPromptDialog`** — обернуть в `SgDialog` (сейчас полностью свой). Это шаблон для всех yes/no/input-диалогов.
- **`SafetyDialog`** — кастомная структура с issues+actions, но overlay/focus можно делегировать. Контент остаётся специфическим в body.
- **`GitActivityDialog`** — проверить, обернуть.

Из feature-диалогов которые УЖЕ на SgDialog: удалить дубликаты `.overlay` в их `.module.css`. Это чистка, она безопасна.

### 4. Конвенции

Зафиксировать в `docs/ru/architecture.md` (раздел UI):
- любой модал = `SgDialog`;
- размеры — только через `size`-пресет, не `width: number`;
- кастомный footer допустим, но дефолт через `onConfirm` предпочтителен;
- никаких своих Esc-обработчиков и backdrop-click — это делает `<dialog>` сам;
- focus-trap — встроен в нативный `<dialog>`, не плодим.

### 5. SgPromptDialog как примитив

После миграции `SgPromptDialog` через `SgDialog` — это становится стандартом для всех «введи строку и подтверди»: rename branch, rename tag, stash message при сохранении, gitignore новая запись и т.п. Проверить что во всех таких местах используется именно он, не локальные формы.

### 6. Починить баг с режимами prompt vs confirm

**Реальный баг, найденный до стрима** (репродукция: тулбар → Stash → открывается окно без поля ввода, только две кнопки):

```ts
// SgPromptDialog.tsx
const isConfirmOnly = !!prompt?.confirmLabel;
```

Корень: режим (нужен ли input) определяется по наличию `confirmLabel`. Как только вызывающий код передаёт кастомный текст кнопки (например «Отложить» для stash), диалог **переключается в confirm-only без инпута**. Это бредовая связь: «хочешь свою надпись на кнопке — лишаешься поля ввода».

Из-за этого `promptStash` в `App.tsx` (передаёт `confirmLabel: loc.stashDialog.confirm`) рендерит окно без места для имени стэша — юзер не может задать message, кроме как нажать «Отложить» и получить дефолтное `WIP on <branch>: <hash>`.

**Что сделать в рамках задачи (вместе с миграцией на SgDialog):**

- В `ShowPromptOptions` ввести явный `kind: 'input' | 'confirm'` (или два отдельных типа `PromptInputOptions` / `PromptConfirmOptions` с дискриминатором). Дефолт — `'input'`.
- Убрать вычисление `isConfirmOnly` через `confirmLabel`. `confirmLabel` теперь свободно задаётся в обоих режимах.
- Старые вызовы `showPrompt({ confirmLabel: ... })` пройти и пометить kind явно: для `promptStash` это `kind: 'input'` (там должно быть поле!).
- Сделать миграцию обратно-совместимой не пытаемся — это баг, ломаем сразу, пройти все ~10 мест вызова.

**Кандидаты на проверку** (везде где сейчас передаётся `confirmLabel` → возможно баг):
- `App.tsx` `promptStash`;
- любые места в `useMenuActions`, `useSyncActions` где stash/rename/create branch/tag вызываются с кастомной кнопкой;
- `getBranchMenuItems`, `commitMenuItems` если они делают `showPrompt` с `confirmLabel`.

Проход — grep по `confirmLabel:` в renderer-коде, для каждого случая решить input или confirm и проставить kind.

## Не делать

- Не выпиливать css-переменные `--sg-dialog-overlay` и др. — они правильные.
- Не вводить новую библиотеку (radix, headless-ui). Нативный `<dialog>` справляется, focus-trap, role и Esc даром.
- Не менять визуал диалогов. Это рефакторинг под капотом, поверхность не трогаем.

## Метрики приёмки

- 0 use cases `<div className="overlay">` в `features/**`;
- все `*Dialog*.tsx` импортируют `SgDialog` из `ui/`;
- `SgPromptDialog` использует `SgDialog` внутри;
- `confirmLabel` НЕ влияет на наличие input'а — режим определяется только явным `kind`;
- ручная проверка: Toolbar → Stash → видно поле для имени стэша + кнопка «Отложить»; ввод имени → создаётся стэш с message; пусто → дефолтный stash (как раньше);
- скриншоты до/после в PR — пиксель-в-пиксель совпадают для всех 14+ диалогов (визуал не меняли).

## Запуск

Реализуй задачу из `docs/tasks/dialogs-unification.md`. Начни с аудит-сводки, потом расширь SgDialog, потом миграция. Без лишних вопросов.
