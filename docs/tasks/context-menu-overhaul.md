# Задача: переделать контекст-меню (submenu, плотность, ограничение ширины)

> Стартовый промпт для нового агентского таба. Скопируй в новый чат.

---

## Проблема

Контекст-меню в GitBor визуально и структурно проигрывает Fork-овскому:

- меню широкое (~500px и растягивается по самому длинному label с полным именем ветки);
- 15–17 пунктов плоским списком, иерархия отсутствует;
- варианты действия (`Soft / Mixed / Hard` для `Reset to`, варианты для `Cherry-pick` / `Revert`) вылиты в общий список вместо submenu;
- любое действие с длинным ref-name (`Перебазировать «feature/SinkevichRN/NRGIND-34782» сюда...`) ломает компоновку меню;
- шрифт и отступы избыточные → меню кажется «толстым» даже когда пунктов мало.

У Fork то же количество действий помещается в узкое меню ~280px за счёт submenu, мельче шрифта и компактнее padding'ов.

## Корень

1. **`SgContextMenu` не поддерживает submenu.** Item-тип:

   ```ts
   { label, shortcut, disabled, danger, action }
   ```

   Подменю невозможно описать — всё рендерится плоско.
2. **Действия-с-вариантами размазаны по плоскому списку.** В `commitMenuItems`, `getBranchMenuItems` и т.п. `Soft/Mixed/Hard reset` — это три отдельных item'а, хотя по смыслу это **один пункт `Reset to commit...` → submenu из трёх вариантов**.
3. **Labels подставляют полное имя ref'а** через `tpl(loc.contextMenu.X, { branch: 'feature/long/name' })`. Меню тянется по самому длинному ref'у.
4. **Нет глобального `max-width` + ellipsis** для пунктов меню.

## Цель

Меню сопоставимы по плотности и иерархии с Fork. Любой длинный ref не ломает компоновку. Действия с вариантами скрыты в submenu.

## Что сделать

### 1. Расширить `SgContextMenuItem` поддержкой submenu

В `src/renderer/src/ui/SgContextMenu.tsx`:

```ts
export type SgContextMenuItem =
  | { divider: true }
  | { header: true; label: string }
  | { label: string; shortcut?: string; disabled?: boolean; danger?: boolean; action?: () => void; submenu?: SgContextMenuItem[] };
```

Поле `submenu?: SgContextMenuItem[]` — массив тех же item'ов, любая вложенность.

### 2. Рендер submenu

- если у пункта есть `submenu` — справа от label показывать индикатор `▸`;
- на hover (с задержкой 150–200мс чтобы не дёргалось при проходе мыши) — открывается дочернее меню справа от родителя;
- если справа не помещается — открывается слева (та же логика viewport-clamp что для основного меню);
- клик по родительскому пункту с submenu **не вызывает `action`** (его не должно быть у submenu-владельца), только раскрывает.

### 3. Применить submenu к существующим меню

В `commitMenuItems`, `getBranchMenuItems`, `getStashMenuItems`, `getTagMenuItems`, `getRemoteMenuItems`:

- **Reset to commit** → один пункт со submenu `Soft (keep staging)` / `Mixed (keep working dir)` / `Hard (discard changes)`.
- **Push** (если есть `Push --force`, `Push --set-upstream`) → пункт `Push` со submenu вариантов.
- **Pull** (rebase / merge / autostash) → submenu.
- **Cherry-pick** — если есть варианты (например `Cherry-pick to current` / `Cherry-pick all`) — submenu, иначе плоско.
- **Revert** аналогично.
- **Branch sub-list при коммите** (на скрине Fork — выбор ветки → справа развернулось `Push / Rename / Copy Branch Name`). Если у нас есть кейс «коммит с несколькими ref'ами на нём» — submenu по ref'ам.

### 4. Глобальная плотность меню (CSS)

В CSS-классах `sg-context-menu` / `sg-context-menu-item` (поискать в `styles/ui-kit.css` или соседних):

- шрифт **12px** (сейчас наследует 13px);
- vertical padding пункта **4–5px** (было ~8px);
- line-height **1.3**;
- `max-width: 360px`, `text-overflow: ellipsis`, `overflow: hidden`, `white-space: nowrap`;
- **полный текст label в `title` атрибуте** (HTML-тултип), чтобы при ellipsis юзер мог hover'ом увидеть полное имя;
- shortcut справа **серым**, минимум 60px колонка.

### 5. Truncate ref-имён в labels — НЕ делать

Не резать `branch.name` в labels. Полное имя нужно для контекста. Truncate решается через CSS `max-width + ellipsis + title`.

### 6. Группировка через divider'ы — пересмотреть

После введения submenu плоских пунктов станет в 2 раза меньше. Дивайдеры перестроить:

- group 1: основные действия (`Checkout`, `Merge`, `Rebase`);
- group 2: создание (`New Branch`, `New Tag`);
- group 3: модификация (`Reset to → submenu`, `Cherry-pick`, `Revert`);
- group 4: служебные (`Save as Patch`, `Compare`);
- group 5: copy (`Copy SHA`, `Copy Info`);
- group 6 (опционально): danger (`Delete...`).

## Файлы

- `src/renderer/src/ui/SgContextMenu.tsx` — новый тип + рендер submenu;
- `src/renderer/src/styles/ui-kit.css` (или соседний) — плотность;
- `src/renderer/src/features/graph/commitMenuItems.ts` — Reset/Cherry-pick/Revert через submenu;
- `src/renderer/src/features/sidebar/sidebarMenuItems.ts` — branch (Push варианты), tag, stash, remote;
- проверить остальные места где `items: SgContextMenuItem[]` собирается (поиск по `SgContextMenuItem`).

## Не делать

- Не вводить keyboard-навигацию по меню в рамках этой задачи (стрелки вверх/вниз/вправо для submenu) — отдельная задача про a11y;
- Не делать «бесконечную вложенность». Достаточно 1 уровня submenu. 2 — крайний случай, не плодим.
- Не переходить на сторонние библиотеки (radix-ui menu) — нативный рендер справляется.

## Метрики приёмки

- меню для коммита помещается в ширину ≤ 360px независимо от длины ref-имени;
- `Reset to` — submenu из 3 вариантов (Soft/Mixed/Hard), а не 3 плоских пункта;
- количество top-level пунктов в меню коммита уменьшилось с ~17 до ~10;
- длинный ref-name отображается с `…` + полный текст в hover-tooltip;
- визуальное сравнение с Fork: плотность и читаемость сопоставимы (скрин до/после в PR).

## Связано

- `docs/tasks/stash-ux.md` — там был блок про плотность меню; после этой задачи в stash-ux ничего CSS-трогать не надо, всё применится автоматически. Откорректировать stash-ux перед его выполнением: пункт 1 заменить на «использовать уже компактный SgContextMenu из context-menu-overhaul».
- `docs/tasks/dialogs-unification.md` — оба про UI-kit, идут в одной волне.

## Запуск

Реализуй задачу из `docs/tasks/context-menu-overhaul.md`. Начни с типа + рендера submenu, потом миграция menu-builder'ов, потом CSS-плотность. Без лишних вопросов.
