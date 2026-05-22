# Задача: диалог checkout при незакоммиченных изменениях

> Стартовый промпт для нового агентского таба. Скопируй в новый чат.

---

## Проблема

В Fork при checkout с локальными изменениями показывают диалог: куда переключиться и что делать с изменениями — оставить как есть, stash и вернуть, или отменить.

В GitBor checkout сразу уходит в git. При dirty tree срабатывает preflight и generic SafetyDialog без выбора. Auto-stash в SafetyNet есть, но до него часто не доходит.

## Цель

Если есть незакоммиченные изменения — перед checkout показать диалог с тремя вариантами (как Fork). Без изменений — checkout как сейчас, без диалога.

## Что сделать

**UI:** модал при checkout из сайдбара, контекстного меню и графа. Три radio + Checkout / Cancel. Default — «не менять».

**Backend:** команда checkout принимает режим (keep / stash / discard). Keep — checkout без stash. Stash — текущий auto-stash. Discard — сброс изменений, потом checkout. Убрать блокировку dirty tree для checkout в preflight.

**Остальное:** i18n, тесты на три режима, подключить все точки входа checkout.

## Риски

Keep может упасть, если git не сможет перенести изменения — показать обычный safety-диалог. Discard необратим — не делать default.

## Связано

`docs/tasks/safety-error-handling.md` — общая safety-инфра.

## Запуск

Реализуй задачу из docs/tasks/checkout-local-changes.md. Без лишних вопросов.
