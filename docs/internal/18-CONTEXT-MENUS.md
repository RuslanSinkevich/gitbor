# 18 — Контекстные меню (правый клик)

## Слой: UI (Renderer)
## Файлы: `renderer/src/components/common/ContextMenu.tsx` + интеграция во все компоненты
## Зависимости: messages.ts (команды), i18n (локализация)

---

## Назначение

Правый клик — основной способ действий над объектами в Fork.
Каждый тип объекта (ветка, тег, коммит, файл, stash, remote) имеет своё контекстное меню.
Меню кастомное (HTML/CSS в Renderer), не нативное ОС.

Переиспользуется из SkyFork. Отличие: CSS-переменные адаптированы под собственную систему тем вместо `--vscode-*`.

## Общий компонент ContextMenu

```typescript
interface ContextMenuItem {
  label: string
  icon?: string
  shortcut?: string
  disabled?: boolean
  danger?: boolean
  submenu?: ContextMenuItem[]
  divider?: boolean
  action?: () => void
}

interface ContextMenuProps {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}
```

Визуально:
```
┌──────────────────────────────────────────┐
│  Переключить на 'develop-int'            │
│  Отправить (Push)                     ▸  │
│  ─────────────────────────────────────── │
│  Слить в 'Core/CRM-5197...'             │
│  Перебазировать 'Core/CRM-5197...'      │
│  Интерактивное перебазирование...        │
│  ─────────────────────────────────────── │
│  Новая ветка...               Ctrl+Sh+B │
│  Новая метка...               Ctrl+Sh+T │
│  ─────────────────────────────────────── │
│  Отслеживание                         ▸  │
│  Переименовать 'develop-int'...      F2  │
│  Удалить 'develop-int'...        Delete  │
│  ─────────────────────────────────────── │
│  Копировать имя ветки                    │
└──────────────────────────────────────────┘
```

---

## Меню по типам объектов

### 1. Локальная ветка

```
Переключить на '{branch}'
Отправить (Push)                        ▸
────────────────────────
Слить '{branch}' в '{current}'
Перебазировать '{current}' на '{branch}'
Интерактивное перебазирование...
────────────────────────
Новая ветка из '{branch}'...
Новая метка на '{branch}'...
────────────────────────
Отслеживание                            ▸
  Установить upstream...
  Убрать upstream
Переименовать '{branch}'...
Удалить '{branch}'...
────────────────────────
Копировать имя ветки
```

### 2. Удалённая ветка

```
Переключить на '{remote/branch}'
Получить (Fetch) '{remote}'
────────────────────────
Слить '{remote/branch}' в '{current}'
Перебазировать '{current}' на '{remote/branch}'
────────────────────────
Новая локальная ветка из '{remote/branch}'...
────────────────────────
Удалить удалённую ветку...
────────────────────────
Копировать имя ветки
```

### 3. Метка (tag)

```
Переключить на '{tag}'
────────────────────────
Новая ветка из '{tag}'...
────────────────────────
Удалить '{tag}'...
Удалить '{tag}' на remote...
────────────────────────
Копировать имя метки
```

### 4. Stash

```
Применить '{stash}'
Применить и удалить '{stash}'
────────────────────────
Удалить '{stash}'...
────────────────────────
Показать изменения
```

### 5. Коммит (в графе)

```
Переключить на этот коммит
────────────────────────
Новая ветка из этого коммита...
Новая метка на этот коммит...
────────────────────────
Cherry-pick этот коммит
Откатить (Revert) этот коммит
────────────────────────
Сбросить '{current}' до этого коммита     ▸
  Soft (сохранить изменения в staging)
  Mixed (сохранить изменения в working dir)
  Hard (удалить изменения)
────────────────────────
Интерактивное перебазирование отсюда...
────────────────────────
Копировать SHA
Копировать SHA (короткий)
Копировать сообщение коммита
```

### 6. Файл (в списке изменений)

```
Открыть файл
Открыть diff
────────────────────────
Добавить в staging (Stage)
Убрать из staging (Unstage)
────────────────────────
Откатить изменения (Discard)
────────────────────────
Копировать путь
Копировать имя файла
```

### 7. Конфликтный файл (при merge)

```
Открыть в редакторе слияния
────────────────────────
Принять нашу версию (Ours)
Принять их версию (Theirs)
────────────────────────
Открыть diff
Открыть файл
────────────────────────
Копировать путь
```

### 8. Remote

```
Получить (Fetch) '{remote}'
────────────────────────
Редактировать '{remote}'...
Удалить '{remote}'...
────────────────────────
Копировать URL
```

---

## Реализация

### ContextMenu компонент

```typescript
function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  return (
    <div className="context-menu" style={{ left: x, top: y }}>
      {items.map(item =>
        item.divider ? <div className="cm-divider" /> :
        item.submenu ? <SubmenuItem item={item} /> :
        <div className="cm-item" onClick={item.action}>
          <span className="cm-label">{item.label}</span>
          {item.shortcut && <span className="cm-shortcut">{item.shortcut}</span>}
        </div>
      )}
    </div>
  );
}
```

### Стилизация

```css
.context-menu {
  position: fixed;
  z-index: 10000;
  min-width: 240px;
  background: var(--sg-menu-background);
  border: 1px solid var(--sg-menu-border);
  border-radius: 6px;
  padding: 4px 0;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}

.cm-item {
  display: flex;
  justify-content: space-between;
  padding: 6px 20px;
  cursor: pointer;
  color: var(--sg-menu-foreground);
}

.cm-item:hover {
  background: var(--sg-menu-selection-background);
  color: var(--sg-menu-selection-foreground);
}

.cm-item.danger { color: #c74e39; }
.cm-item.disabled { opacity: 0.4; pointer-events: none; }
```

CSS-переменные `--sg-*` (SkyFork) вместо `--vscode-*`. Определяются в системе тем приложения.

---

## Диалоги подтверждения

Опасные операции требуют подтверждения:

```
┌──────────────────────────────────────────┐
│  ⚠ Удалить ветку 'develop-int'?         │
│                                          │
│  Эта операция необратима.                │
│  Ветка будет удалена локально.           │
│                                          │
│  ☐ Также удалить на remote (origin)     │
│                                          │
│  ┌──────────┐  ┌──────────┐              │
│  │ Удалить  │  │ Отмена   │              │
│  └──────────┘  └──────────┘              │
└──────────────────────────────────────────┘
```

Операции с подтверждением:
- Delete branch (опция: удалить на remote)
- Delete tag (опция: удалить на remote)
- Stash drop
- Discard file changes
- Reset hard
- Force push
- Delete remote

---

## Локализация

Все пункты меню через `t()`:
```typescript
const branchMenu = [
  { label: t('contextMenu.checkout', { branch: name }) },
  { label: t('contextMenu.push') },
  ...
];
```

Секция `contextMenu` в `ru.json` и `en.json`.
