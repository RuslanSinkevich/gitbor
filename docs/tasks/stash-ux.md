# Задача: UX работы со стэшами (меню, диалог Apply, double-click)

> Стартовый промпт для нового агентского таба. Скопируй в новый чат.

---

## Проблема

Текущее поведение работы со стэшами в сайдбаре:

1. **Контекст-меню расползается на полэкрана.** Пункты `stashApply`, `stashPop`, `stashDrop` подставляют полный `stash.message` в label (см. `src/renderer/src/features/sidebar/sidebarMenuItems.ts:83-101`). Message stash'а — это git'овый WIP-subject вида `WIP on feature/SinkevichRN/NRGIND-34782: c3ad668e5 build(client-new): отключить manualChunks в Vite из-за ошибок совместимости с React 19`. Меню получается шириной во весь экран, читать невозможно, эстетически уродливо.
2. **Нет диалога Apply Stash.** В Fork и других git-клиентах при «Apply» открывается компактный модал с:
   - бейджем имени стэша (с troncate),
   - чекбоксом «Delete stash after applying» (= pop, выключен по умолчанию),
   - подсказкой «Stash will not be deleted if a conflict occurs»,
   - кнопками Apply / Cancel.

   У нас выбор apply vs pop спрятан в двух отдельных длинных пунктах меню. Юзеру не очевидно, что pop = apply + drop.
3. **Double-click по stash не работает.** В `BranchTree` дабл-клик по ветке делает checkout, аналогичного хендлера для stash нет. Естественное действие «дважды кликнул по стэшу → применить» отсутствует.
4. **«Показать изменения» открывает stash как обычный коммит** — это ок, но не подсвечено что выбранный stash активен. Курсор/highlight в sidebar тоже отсутствует.

## Цель

Сделать stash в сайдбаре равноправным гражданином: компактное меню, нормальный диалог применения, понятные действия с keyboard/mouse.

## Что сделать

### 1. Меню стэшей — структура

CSS-плотность меню и `max-width + ellipsis` — общая правка UI-kit'а, она в **`docs/tasks/context-menu-overhaul.md`**. Стэш её получает автоматически.

В `src/renderer/src/features/sidebar/sidebarMenuItems.ts → getStashMenuItems` структуру **не меняем** — `{ stash }` плейсхолдеры с message остаются (контекст «какой именно стэш применяю» нужен). После `context-menu-overhaul` длинный message в пункте будет с `…` и полным текстом в hover-tooltip.

Единственная структурная правка здесь — заменить два отдельных пункта `Apply` / `Pop` на один `Apply...` со submenu или с диалогом (см. пункт 2). Пункт `Pop` напрямую можно оставить как «быстрый путь» вторым.

### 2. Apply Stash диалог

Новый компонент `src/renderer/src/features/stash/ApplyStashDialog.tsx` (или в `ui/` если будет переиспользоваться).

Контент:

- заголовок: «Apply Stash»;
- строка с именем стэша (с troncate и тултипом на полное имя): `Stash to apply: stash@{0} WIP on feature/...`
- чекбокс: `Delete stash after applying` (= `pop` поведение);
- подсказка под чекбоксом, отдельным fine-print: `Stash will not be deleted if a conflict occurs.`;
- footer: `Apply` (primary) + `Cancel`.

Логика:

- если чекбокс выключен → команда `stashApply` (apply без drop);
- если включён → команда `stashPopIndex` (apply + drop, **drop не сработает при конфликте** — это уже поведение `git stash pop`, ничего дополнительно делать не надо, но подсказка должна это явно проговаривать).
- после успеха — закрыть диалог, тост «Stash applied» (или success в журнале);
- при конфликте — диалог закрывается, открывается merge editor (поведение из `error-severity-system.md` для `conflict` severity = warning).

Диалог делать **через SgDialog** сразу (после `dialogs-unification.md` это станет стандартом). Если задача идёт ПОСЛЕ dialogs-unification — использовать новый расширенный SgDialog с `kind: 'input'` правильно.

### 3. Double-click handler

В `Sidebar.tsx` / `BranchTree.tsx` (или там где рендерятся stash-элементы) добавить `onDoubleClick`:

- двойной клик на stash → открывает **Apply Stash диалог** (не сразу apply, потому что юзер может хотеть pop, не apply).

Альтернатива: дефолтное действие double-click = `Apply` без подтверждения, а Pop — через меню. Решить по UX: в Fork double-click открывает диалог. Делаем как Fork.

### 4. Highlight активного stash

Когда юзер кликнул `Show Changes` для stash — этот stash в сайдбаре подсветить как «выбран» (аналог `itemCurrent` для ветки). Сейчас selection отсутствует, навигация теряется.

### 5. i18n

Обновить ключи в `ru.ts` / `en.ts`:

```
contextMenu.stashApply: 'Применить...'  (было: 'Применить «{stash}»')
contextMenu.stashPop:   'Применить и удалить'  (было: 'Применить и удалить «{stash}»')
contextMenu.stashDrop:  'Удалить...'  (было: 'Удалить «{stash}»...')

stashDialog.applyTitle: 'Применить стэш'
stashDialog.applyTo:    'Стэш для применения:'
stashDialog.deleteAfter:'Удалить стэш после применения'
stashDialog.conflictNote:'Стэш не будет удалён при конфликте.'
stashDialog.applyConfirm:'Применить'
```

Аналогично en.

### 6. Auto-stash отдельная категория

В списке Stashes в сайдбаре наши собственные авто-стэши (с префиксом `[GitBor auto-stash]` из `SafetyNet.AUTO_STASH_PREFIX`) — отдельной группой или с иконкой 🤖 / спецбейджем. Юзер должен отличать «моё» от «безопасностью созданного». Сейчас они в общем списке и выглядят как обычные стэши.

## Не делать

- Не выпиливать `stashPop` как отдельную команду в IPC — она нужна для toolbar кнопки и hotkey.
- Не переписывать модель стэшей в core (Stash[] остаётся как есть).
- Не делать drag&drop стэшей — это отдельная история, нет use-case прямо сейчас.

## Метрики приёмки

- Контекст-меню сжато глобально: шрифт 12px, padding 4–5px, max-width 600px с ellipsis, danger-кнопка inline справа. Применено ко всем меню (stash/branch/tag/remote).
- Длинный stash-message в пункте меню перестал ломать сетку (помещается в одну строку с …, полный текст в title);
- Apply Stash диалог открывается через `Apply...` пункт меню и через double-click;
- чекбокс «Delete after applying» работает: выключен → стэш остаётся, включён → стэш удалён (если не было конфликта);
- при конфликте стэш не удалён даже если чекбокс был включён, и эта подсказка показана юзеру до клика;
- auto-stash от SafetyNet визуально отличается от ручных стэшей в списке.

## Связано

- `docs/tasks/dialogs-unification.md` — Apply Stash диалог делать через расширенный SgDialog (после миграции);
- `docs/tasks/error-severity-system.md` — конфликт при stash apply классифицируется как `conflict` severity=warning, обрабатывается через merge editor (не модал).

## Запуск

Реализуй задачу из `docs/tasks/stash-ux.md`. Без лишних вопросов.
