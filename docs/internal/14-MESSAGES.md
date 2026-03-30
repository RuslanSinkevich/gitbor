# 14 — messages.ts (IPC протокол)

## Слой: Bridge Layer
## Файл: `src/core/bridge/messages.ts`
## Зависимости: types.ts

---

## Назначение

Типизированный протокол обмена сообщениями между Renderer Process (React) и Main Process (Node.js) через Electron IPC.
Два направления: команды от UI и события от бэкенда.

Адаптирован из SkyFork: `WebviewCommand` → то же, `ExtensionEvent` → то же. Протокол идентичен, меняется только транспорт (IPC вместо postMessage).

## Renderer → Main (команды)

```typescript
type WebviewCommand =
  // Инициализация
  | { type: 'ready' }

  // Данные
  | { type: 'getState' }
  | { type: 'getCommitDetails'; hash: string }
  | { type: 'getGraphData'; maxCount: number }
  | { type: 'getDiff'; file: string; hash?: string }
  | { type: 'getFileDiff'; file: string; staged: boolean }

  // Git операции
  | { type: 'checkout'; branch: string }
  | { type: 'commit'; message: string; amend: boolean }
  | { type: 'fetch' }
  | { type: 'pull' }
  | { type: 'push' }
  | { type: 'stash'; message?: string }
  | { type: 'stashPop' }
  | { type: 'stashApply'; index: string }
  | { type: 'stashDrop'; index: string }

  // Merge
  | { type: 'startMerge'; source: string; options: MergeOptions }
  | { type: 'getConflictFiles' }
  | { type: 'getMergeFileTree' }
  | { type: 'resolveWithOurs'; file: string }
  | { type: 'resolveWithTheirs'; file: string }
  | { type: 'completeMerge'; message?: string }
  | { type: 'abortMerge' }

  // Ветки
  | { type: 'createBranch'; name: string; from: string }
  | { type: 'renameBranch'; oldName: string; newName: string }
  | { type: 'deleteBranch'; branch: string; force?: boolean }

  // Теги
  | { type: 'createTag'; name: string; ref: string }
  | { type: 'deleteTag'; name: string; remote?: boolean }

  // Коммиты
  | { type: 'cherryPick'; hash: string }
  | { type: 'revert'; hash: string }
  | { type: 'resetTo'; hash: string; mode: 'soft' | 'mixed' | 'hard' }
  | { type: 'rebase'; source: string; target: string }

  // Файлы
  | { type: 'stageFile'; file: string }
  | { type: 'unstageFile'; file: string }
  | { type: 'discardFileChanges'; file: string }

  // Remote
  | { type: 'fetchRemote'; remote: string }
  | { type: 'editRemote'; name: string; url: string }
  | { type: 'deleteRemote'; name: string }

  // Мульти-репо
  | { type: 'openRepo'; path: string }
  | { type: 'closeRepo'; index: number }
  | { type: 'switchRepo'; index: number }

  // Системные
  | { type: 'openFileInEditor'; file: string }
  | { type: 'openInTerminal'; path: string }
  | { type: 'openInFileManager'; path: string }
```

## Main → Renderer (события)

```typescript
type ExtensionEvent =
  // Полное состояние (при инициализации)
  | { type: 'fullState'; data: AppState }

  // Частичное обновление (при изменениях)
  | { type: 'stateUpdate'; data: Partial<AppState> }

  // Ответы на запросы
  | { type: 'commitDetails'; data: CommitDetail }
  | { type: 'graphData'; data: CommitGraphData }
  | { type: 'diffData'; data: { file: string; content: string } }

  // Статус операций
  | { type: 'operationStart'; operation: string }
  | { type: 'operationEnd'; operation: string; success: boolean; error?: string }

  // Merge
  | { type: 'mergeState'; data: MergeState }
  | { type: 'mergeCompleted' }
  | { type: 'mergeAborted' }

  // Конфигурация
  | { type: 'config'; lang: string; theme: string }

  // Восстановление
  | { type: 'recoveryRequired'; issues: RecoveryIssue[] }

  // Ошибки
  | { type: 'error'; message: string }
```

## Расширяемость

Добавить новую команду:
1. Добавить union member в `WebviewCommand`
2. TypeScript покажет ошибку в IPC Bridge (необработанный case)
3. Добавить обработку в IPC Bridge
4. Готово

TypeScript сам проверяет exhaustiveness — невозможно забыть обработать новый тип.
