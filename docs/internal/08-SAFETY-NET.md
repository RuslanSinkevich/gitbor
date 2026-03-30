# 08 — SafetyNet

## Слой: Safety Layer
## Файл: `src/core/safety/SafetyNet.ts`
## Зависимости: types.ts, GitExecutor, OperationJournal

---

## Назначение

Страховочная сетка. Оборачивает каждую деструктивную git-операцию:
1. Сохраняет снапшот состояния (HEAD, auto-stash)
2. Записывает в журнал
3. Выполняет операцию
4. Записывает завершение в журнал
5. Если ошибка — автоматический откат

Переиспользуется из SkyFork. Отличие: маркировка auto-stash `[SkyFork auto-stash]` вместо `[SkyFork auto-stash]`.

## Интерфейс

```typescript
class SafetyNet {
  constructor(
    private git: GitExecutor,
    private journal: OperationJournal
  ) {}

  async wrapDestructive<T>(
    operationName: string,
    params: Record<string, string>,
    operation: () => Promise<T>,
    options?: {
      autoStash?: boolean
      autoRollback?: boolean
    }
  ): Promise<OperationResult<T>>

  async rollback(journalEntryId: string): Promise<void>

  async restoreAutoStash(stashHash: string): Promise<void>
}
```

## Алгоритм wrapDestructive

```
async wrapDestructive(name, params, operation, options):

  1. Получить текущий HEAD:
     headHash = git rev-parse HEAD
     branchName = git rev-parse --abbrev-ref HEAD

  2. Проверить незакоммиченные изменения:
     status = git status --porcelain
     hasUncommitted = status.length > 0

  3. Если hasUncommitted и autoStash:
     git stash push -m "[SkyFork auto-stash] before {name}"
     autoStashHash = git rev-parse stash@{0}

  4. Записать в журнал:
     journalId = journal.begin({
       operation: name,
       savedState: { headHash, branchName, hasUncommitted, autoStashHash },
       params
     })
     — С ЭТОГО МОМЕНТА СИСТЕМА ЗАЩИЩЕНА ОТ ОБРЫВА —

  5. Попробовать выполнить операцию:
     try {
       result = await operation()
     } catch (error) {
       journal.fail(journalId, error.message)

       if (autoRollback) {
         git reset --hard headHash
         git checkout branchName
         if (autoStashHash) git stash pop
       }

       return { success: false, error: error.message, rollbackAvailable: true }
     }

  6. Операция успешна:
     journal.complete(journalId)

  7. Восстановить auto-stash (если был):
     if (autoStashHash) {
       try { git stash pop }
       catch { /* stash pop конфликт — оставить stash, уведомить пользователя */ }
     }

  8. Вернуть результат:
     return { success: true, data: result, rollbackAvailable: true }
```

## Какие операции оборачиваются

| Операция | autoStash | autoRollback |
|----------|-----------|-------------|
| checkout | да | да |
| merge | да | да |
| rebase | да | да |
| reset | да | да |
| cherry-pick | да | да |
| stash drop | нет | нет |
| push | нет | нет (необратимо на remote) |
| fetch | нет | нет (read-only по сути) |

## Какие операции НЕ оборачиваются

Read-операции: log, status, branch --list, tag --list, diff, show.
Они не меняют состояние репозитория.

## Auto-Stash: маркировка

Сообщение stash: `[SkyFork auto-stash] before checkout develop`
Формат: `[SkyFork auto-stash] before {operationName} {params}`

По этой маркировке RecoveryManager находит "наши" stash'и при восстановлении.

## Ручной rollback

Пользователь может вызвать rollback из UI:
```
SafetyNet.rollback(journalEntryId):
  1. Прочитать запись из журнала
  2. git reset --hard savedState.headHash
  3. git checkout savedState.branchName
  4. Если есть autoStashHash → git stash apply autoStashHash
  5. Обновить запись в журнале: status = 'rolled_back'
```
