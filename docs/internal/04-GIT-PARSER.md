# 04 — GitParser

## Слой: Git Layer
## Файл: `src/core/git/GitParser.ts`
## Зависимости: types.ts

---

## Назначение

Чистые функции парсинга вывода git. Без побочных эффектов, без состояния.
Принимают строку (stdout от GitExecutor) — возвращают типизированные данные.

Полностью переиспользуется из SkyFork без изменений.

## Функции

```typescript
function parseCommits(stdout: string): Commit[]
function parseBranches(stdout: string): Branch[]
function parseTags(stdout: string): Tag[]
function parseStashes(stdout: string): Stash[]
function parseRemotes(stdout: string): Remote[]
function parseStatus(stdout: string): FileStatus[]
function parseFileChanges(stdout: string): FileChange[]
function parseRefs(refString: string): RefInfo[]
```

## Формат разделителей

Используем NUL byte (`\x00`) как разделитель полей внутри записи.
Используем newline (`\n`) как разделитель записей.

NUL byte не встречается в git-данных (имена, email, сообщения) — безопасный разделитель.

## Git-команды и форматы

### Коммиты
```
git log --all --topo-order --max-count=500 --format="%H%x00%P%x00%an%x00%ae%x00%at%x00%D%x00%s"
```
Поля: hash, parents (пробел-разделённые), authorName, authorEmail, authorDate (unix), refs (декорации), subject

### Ветки
```
git branch -a --format="%(refname:short)%x00%(objectname:short)%x00%(upstream:short)%x00%(HEAD)"
```
Поля: name, hash, upstream, isCurrent (* или пусто)

### Метки
```
git tag --sort=-creatordate --format="%(refname:short)%x00%(objectname:short)"
```

### Stash
```
git stash list --format="%gd%x00%H%x00%gs"
```

### Remotes
```
git remote -v
```
Формат: `name\turl (fetch|push)`

### Status
```
git status --porcelain=v1
```
Формат: `XY path` где X=staged, Y=unstaged

### File changes (для коммита)
```
git diff-tree --no-commit-id -r --name-status HASH
```

## Пример парсинга

```typescript
function parseCommits(stdout: string): Commit[] {
  if (!stdout.trim()) return [];

  return stdout.trim().split('\n').map(line => {
    const [hash, parents, authorName, authorEmail, authorDate, refs, subject] = line.split('\x00');
    return {
      hash,
      parents: parents ? parents.split(' ') : [],
      authorName,
      authorEmail,
      authorDate: parseInt(authorDate, 10) * 1000,
      refs: refs ? parseRefs(refs) : [],
      subject,
    };
  });
}
```

## Устойчивость к ошибкам

- Пустой stdout → пустой массив (не ошибка)
- Неполная строка (обрезанный вывод) → пропускаем, не падаем
- Неизвестный формат ref → type = 'branch' по умолчанию
- Некорректная дата → 0

## Тестируемость

Чистые функции = идеальны для unit-тестов.
Входные данные — строки. Выходные — типизированные объекты.
Можно покрыть 100% случаев без моков.
