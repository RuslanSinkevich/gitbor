# .gitignore Template — как у Fork

## Проблема

В GitBor есть `GitignoreDialog` (меню Repository → .gitignore…), но он не решает задачу «быстро собрать ignore для нового репо»:

- Нет **проактивной подсказки** — юзер не знает, что `.gitignore` отсутствует, пока сам не полезет в меню
- Шаблоны — плоский список кнопок, без групп OS / IDE / Language
- Основной экран — textarea-редактор, без превью «что получится»
- Нет ощущения «отметил чекбоксы → Add → готово»

Fork решает это за 10 секунд: баннер → модалка с категориями + live preview → Add.

## Цель

Юзер видит, что `.gitignore` нет, получает баннер в Changes, открывает модалку в духе Fork (категории с чекбоксами слева, read-only preview справа), отмечает нужное, жмёт Add — файл появляется, баннер исчезает.

## Референс

Fork: жёлтый info-баннер над changes + модалка **Add .gitignore Template** — слева категории (OS, IDE, Language) с чекбоксами, справа моноширинный preview, внизу Add/Cancel.

## Scope

**Баннер:**
- Inline info-strip в панели Changes, если `.gitignore` отсутствует или пустой
- Кнопка «Add .gitignore…» + dismiss (×) на сессию
- После Add — баннер исчезает

**Модалка:**
- Две колонки: слева категории (OS / IDE / Language) с чекбоксами, справа live preview
- Дефолт OS = текущая платформа
- Add создаёт файл в корне, Cancel закрывает
- Add disabled если ничего не выбрано
- Если `.gitignore` уже есть (вход из меню) — merge новых правил, не blind replace
- i18n en + ru
- Визуально: `SgDialog`, `SgCheckbox`, ui-kit стиль, light/dark

**Точки входа:**
- Баннер → Add .gitignore…
- Меню Repository → .gitignore… (как сейчас, та же модалка)

## Критерии готовности

- Баннер на Changes, если `.gitignore` нет — dismiss работает, после Add скрывается
- Модалка: категории + preview, Add создаёт файл, preview обновляется при toggle
- Дефолт OS = платформа
- Merge при существующем файле (или обоснование почему replace допустим)
- i18n en + ru
- Вход из меню Repository сохранён

## Вне scope

- Редактируемый textarea внутри модалки (оставить старый flow или отложить)
- Авто-commit `.gitignore`
- Баннер вне панели Changes
- Filter/search по шаблонам (nice to have, не блокер)

## Связано

- `src/renderer/src/features/gitignore/` — текущая реализация
- `src/renderer/src/features/changes/` — место для баннера
- Fork: Add .gitignore Template — визуальный референс
