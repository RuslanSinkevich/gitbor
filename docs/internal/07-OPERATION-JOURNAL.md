# 07 — OperationJournal (Write-Ahead Log)

## Слой: Safety Layer
## Файл: `src/core/safety/OperationJournal.ts`
## Зависимости: types.ts, AtomicWrite

---

## Назначение

Write-Ahead Log (WAL). Прежде чем выполнить git-операцию — записать намерение.
Если система упала — при следующем запуске прочитать журнал и восстановиться.

Переиспользуется из SkyFork. Отличие: имя файла `SkyFork-journal.json` вместо `skyfork-journal.json`.

## Хранилище

Файл: `.git/SkyFork-journal.json`

Почему в `.git/`:
- Привязан к конкретному репозиторию
- Не попадает в рабочую директорию
- Не попадает в git status / git add
- Удаляется вместе с репозиторием

## Интерфейс

```typescript
class OperationJournal {
  constructor(private gitDir: string) {}

  async begin(entry: {
    operation: string,
    savedState: SavedState,
    params: Record<string, string>
  }): Promise<string>

  async complete(id: string): Promise<void>

  async fail(id: string, error: string): Promise<void>

  async getIncomplete(): Promise<JournalEntry[]>

  async getAll(): Promise<JournalEntry[]>

  async cleanup(maxAgeDays?: number): Promise<void>
}
```

## Жизненный цикл записи

```
┌─────────┐    begin()     ┌─────────┐
│  (нет)  │ ──────────────►│ started │
└─────────┘                └────┬────┘
                                │
                    ┌───────────┼───────────┐
                    │           │           │
                complete()   fail()    [ОБРЫВ]
                    │           │           │
                    ▼           ▼           ▼
              ┌──────────┐ ┌────────┐  Остаётся
              │completed │ │ failed │  "started"
              └──────────┘ └────────┘  → RecoveryManager
```

## Формат файла

```json
{
  "version": 1,
  "entries": [
    {
      "id": "op_1708534800_abc123",
      "operation": "checkout",
      "startedAt": 1708534800000,
      "status": "completed",
      "savedState": {
        "headHash": "a4b00cfc3d21e5f7...",
        "branchName": "main",
        "hasUncommitted": true,
        "autoStashHash": "abc123def456..."
      },
      "params": {
        "branch": "develop"
      },
      "completedAt": 1708534801200
    }
  ]
}
```

## Критический момент: атомарность записи

Каждая запись в журнал — через AtomicWrite:

```typescript
async begin(entry): Promise<string> {
  const id = `op_${Date.now()}_${randomId()}`;
  const journalEntry: JournalEntry = {
    id,
    ...entry,
    startedAt: Date.now(),
    status: 'started',
  };

  const journal = await this.read();
  journal.entries.push(journalEntry);

  await atomicWriteJSON(this.journalPath, journal);

  return id;
}

async complete(id: string): Promise<void> {
  const journal = await this.read();
  const entry = journal.entries.find(e => e.id === id);
  if (entry) {
    entry.status = 'completed';
    entry.completedAt = Date.now();
  }

  await atomicWriteJSON(this.journalPath, journal);
}
```

## Сценарии обрыва

### Обрыв ДО begin()
Журнал не изменился. Git не тронут. Безопасно.

### Обрыв ВО ВРЕМЯ begin() (AtomicWrite)
Файл журнала либо старый (begin не записался), либо новый (begin записался).
- Если старый → как если бы begin не вызывался → безопасно
- Если новый → запись "started" есть, но git-операция не начата → RecoveryManager очистит запись

### Обрыв ПОСЛЕ begin(), ДО git-операции
Запись "started" в журнале. Git не тронут. RecoveryManager: "Операция начата, но не выполнена. Очистить?"

### Обрыв ВО ВРЕМЯ git-операции
Запись "started" в журнале. Git может быть в промежуточном состоянии.
RecoveryManager: "Обнаружена прерванная операция X. Откатить к сохранённому состоянию?"
Откат: git reset --hard savedState.headHash + восстановление auto-stash.

### Обрыв ВО ВРЕМЯ complete()
Запись "started" в журнале (complete не записался). Git-операция фактически завершена.
RecoveryManager: предложит откат → откатит успешную операцию → пользователь теряет результат операции, но НЕ теряет код.

### Обрыв ПОСЛЕ complete()
Всё завершено корректно. Безопасно.

## Очистка

Завершённые записи (status: completed/failed) старше 7 дней удаляются при запуске.
Незавершённые (status: started) — никогда не удаляются автоматически, только через RecoveryManager.
