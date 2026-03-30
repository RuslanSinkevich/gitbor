# 02 — types.ts

## Слой: Git Layer
## Файл: `src/core/git/types.ts`
## Зависимости: нет

---

## Назначение

Единый файл с типами данных для всей системы. Все модули импортируют типы отсюда.
Нет логики, нет побочных эффектов — только интерфейсы и типы.

Полностью переиспользуется из SkyFork без изменений.

## Интерфейсы

### Git-данные

```typescript
interface Commit {
  hash: string
  parents: string[]
  authorName: string
  authorEmail: string
  authorDate: number          // timestamp ms
  refs: RefInfo[]
  subject: string
}

interface RefInfo {
  name: string
  type: 'branch' | 'remote' | 'tag' | 'head'
}

interface Branch {
  name: string
  hash: string
  upstream?: string
  isCurrent: boolean
  isRemote: boolean
}

interface Tag {
  name: string
  hash: string
}

interface Stash {
  index: string
  hash: string
  message: string
}

interface Remote {
  name: string
  fetchUrl: string
  pushUrl: string
}

interface FileStatus {
  path: string
  status: 'M' | 'A' | 'D' | 'R' | 'U' | '?'
  staged: boolean
}

interface FileChange {
  path: string
  status: string
}

interface CommitDetail {
  hash: string
  parents: string[]
  authorName: string
  authorEmail: string
  authorDate: number
  committerName: string
  committerEmail: string
  commitDate: number
  refs: RefInfo[]
  subject: string
  body: string
  files: FileChange[]
}
```

### Результаты операций

```typescript
interface MergeResult {
  success: boolean
  conflicts: string[]
}

interface OperationResult<T = void> {
  success: boolean
  data?: T
  error?: string
  rollbackAvailable: boolean
}
```

### Граф

```typescript
interface GraphNode {
  commitIndex: number
  column: number
  color: string
  connections: GraphConnection[]
}

interface GraphConnection {
  fromCol: number
  toCol: number
  color: string
}

interface GraphLayoutData {
  nodes: GraphNode[]
  maxColumns: number
}

interface CommitGraphData {
  commits: Commit[]
  layout: GraphLayoutData
}
```

### Git Executor

```typescript
interface GitExecOptions {
  cwd?: string
  timeout?: number            // ms, по умолчанию 30000
  maxBuffer?: number          // bytes, по умолчанию 50MB
}

interface GitExecResult {
  stdout: string
  stderr: string
  exitCode: number
  duration: number            // ms
}
```

### Состояние приложения

```typescript
interface AppState {
  repoPath: string
  repoName: string
  currentBranch: string
  branches: Branch[]
  tags: Tag[]
  stashes: Stash[]
  remotes: Remote[]
  stagedFiles: FileStatus[]
  unstagedFiles: FileStatus[]
  conflicts: string[]
  ahead: number
  behind: number
  commits: Commit[]
  graphLayout: GraphLayoutData
  selectedCommitHash: string | null
  isOperationRunning: boolean
  currentOperation: string | null
  openRepos: RepoInfo[]
  activeRepoIndex: number
}

interface RepoInfo {
  name: string
  path: string
}
```

### Журнал операций

```typescript
interface JournalEntry {
  id: string
  operation: string
  startedAt: number
  status: 'started' | 'completed' | 'failed'
  savedState: SavedState
  params: Record<string, string>
  completedAt?: number
  error?: string
}

interface SavedState {
  headHash: string
  branchName: string
  hasUncommitted: boolean
  autoStashHash?: string
}
```

### Merge (ConflictManager)

```typescript
interface MergeOptions {
  noCommit: boolean
  squash: boolean
  ffOnly: boolean
}

interface ConflictFile {
  path: string
  status: 'conflicted' | 'resolved' | 'staged'
  oursModified: boolean
  theirsModified: boolean
}

interface MergeFileTree {
  unstaged: FileTreeNode[]
  staged: FileTreeNode[]
}

interface FileTreeNode {
  name: string
  path: string
  type: 'file' | 'directory'
  status?: 'M' | 'A' | 'D' | 'U'
  children?: FileTreeNode[]
}

interface MergeState {
  inProgress: boolean
  sourceBranch: string
  targetBranch: string
  totalConflicts: number
  resolvedConflicts: number
  conflictFiles: ConflictFile[]
  fileTree: MergeFileTree
}
```

## Правила

- Все типы экспортируются с `export`
- Никаких `any` — строгая типизация
- Enum'ы не используем — union types (`'M' | 'A' | 'D'`)
- Все поля readonly где возможно
