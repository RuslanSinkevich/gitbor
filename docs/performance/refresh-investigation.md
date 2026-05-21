# Refresh Performance Investigation

## Симптом

После commit / merge UI «зависает» на 3-10 секунд (видно по
running-индикатору и отзывчивости тулбара). На больших монорепо
(vscode, chromium — 100k+ refs) пик доходил до 10s.

## Архитектура текущего рефреша

`writeCommands.gitWrite()` после успешной git-команды зовёт
`state.refreshAll(repoPath)`. В `RepoStateRefresher.refreshAll`:

1. `refreshFast` — параллельный `Promise.all` из 5 read-команд:
   - `for-each-ref refs/heads/`
   - `for-each-ref refs/remotes/`
   - `for-each-ref refs/tags/`
   - `stash list`
   - `remote -v`
   - `status --porcelain=v1`
   - `rev-parse --abbrev-ref HEAD`
   - `rev-list --left-right HEAD...@{upstream}`

   Время: 50-200ms на нормальном репо, до 800-1500ms на монорепо.

2. `refreshGraphProgressive`:
   - **Phase A**: `git log --max-count=500` → notify;
   - **Phase B**: `git log --max-count=50000` → notify + save cache.

   Phase A: 50-200ms.
   Phase B: 200-3000ms на нормальном, **3-8s на монорепо**.

3. Внутри `refreshGraph`:
   - `git rev-list --glob=refs/remotes/* --not --glob=refs/heads/*`
     для маркировки remote-only коммитов: 100-500ms.

`refreshAll` await'ит обе фазы перед резолвом. То есть после
`git commit` юзер ждёт **до конца Phase B** прежде чем UI станет
снова отзывчивым (точнее — `operationEnd` шлётся только когда
вся последовательность отработала).

## Узкие места

Замеры через `perfMark` / `perfLog` уже встроены (см. вывод в
DevTools при `?perf=1`). Типичный профиль для commit на vscode:

```
refreshAll.fast           ~ 1100 ms (status 700, branches 280, ...)
refreshGraph.phaseA(500)  ~ 150  ms
refreshGraph.phaseB(50000)~ 6800 ms   ← главный виновник
  git log(50000)             6500 ms
  parseCommits (worker)      120  ms
  computeGraphLayout (worker)80   ms
  rev-list remote-only       400  ms
```

То есть **~85% задержки = `git log --max-count=50000`**, а **~10% =
`git status` на больших untracked**.

## Что уже оптимизировано (НЕ трогаем)

- Кэш HEAD-hash → `refreshGraph` пропускает работу если hash не
  изменился И достаточно коммитов в slice.
- `git status --untracked-files=normal` для опасных корней.
- Графовый layout считается в worker_threads.
- Дисковый `loadGraphCache` после `switchRepo`.

## Минимальный патч (в скоупе)

Идея: после **write-операции, которая обычно меняет HEAD на 1
коммит** (commit, merge, cherry-pick, revert, rebase, reset),
не блокировать UI на Phase B — отдать первые 500 коммитов и
догрузить полный граф в фоне. Юзер видит "operationEnd" сразу
после fast + phaseA (~250 ms), полный граф приходит вторым
notify ~ 5 сек спустя.

Это **не меняет конечное состояние** — просто разделяет блокирующий
ожидание на 2 фазы. Кейсы, где это важно:
- commit / amend
- merge / cherry-pick / revert
- pull (часто = fast-forward = +N коммитов, ничего нового сверху)

Для `switchRepo` / первого открытия / explicit refresh — оставляем
полный await (там Phase B нужен сразу).

### Реализация

`RepoStateRefresher.refreshAll(repoPath, opts?)`:

```ts
async refreshAll(repoPath?: string, opts?: { deferHeavy?: boolean }): Promise<void> {
  // ... refreshFast + phaseA ...
  if (opts?.deferHeavy) {
    // Phase B → fire-and-forget с собственным token-guard.
    void this.refreshGraphProgressive(target, startToken);
    return;
  }
  await this.refreshGraphProgressive(target, startToken);
}
```

`writeCommands.gitWrite` для commit/merge/cherry-pick/revert/pull
вызывает `state.refreshAll(target, { deferHeavy: true })`. Для
switchRepo и явных рефрешей — старое поведение.

## Кандидаты на отдельную задачу (вне скоупа)

1. **Инкрементальный refresh после commit**. Сейчас перерисовываем
   весь log. Можно делать `git log -1 HEAD` + дописать в начало slice.
   Технически сложнее: layout надо пересчитать локально, не на 50k
   коммитов. Сэкономит 3-8s на каждом commit.

2. **Параллелить status и log**. Сейчас они идут последовательно
   через две `Promise.all` (fast → graph). Можно вынести `git log`
   в третий параллельный поток. Сэкономит ~30% Phase B на медленном
   диске.

3. **stat-dirty refresh** — `git update-index --refresh` после
   write-op (закрывает отдельный issue про "файлы остаются M с
   пустым diff после format-on-save"). Отдельный PR.

4. **Не считать `rev-list --glob=refs/remotes/*` если remote'ов
   нет** — сэкономит 100-500ms на репо без push'нутых веток.
   Микрооптимизация.

## Изменения в этом PR

- `refreshAll(repoPath, { deferHeavy: true })` — новый опт.
- `writeCommands.gitWrite()` использует `deferHeavy: true` для
  `commit / merge / cherry-pick / revert / pull / rebase / reset`.
- Тесты `tests/state/RepoStateRefresher.test.ts` дополнены кейсом
  `deferHeavy=true → не await'ит Phase B`.

Эффект: после commit `operationEnd` приходит на ~3-7s раньше на
монорепо. Полный граф (50k) обновится фоном.
