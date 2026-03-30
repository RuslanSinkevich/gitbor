# 06 — AtomicWrite

## Слой: Safety Layer
## Файл: `src/core/safety/AtomicWrite.ts`
## Зависимости: нет (только Node.js fs)

---

## Назначение

Атомарная запись файлов. Гарантирует что файл либо полностью старый, либо полностью новый. Никогда не полу-записанный. Даже если питание пропало в момент записи.

Это фундамент безопасности всей системы. OperationJournal использует AtomicWrite для записи журнала.

Полностью переиспользуется из SkyFork без изменений.

## Принцип работы

```
1. Записать данные во временный файл (target + '.tmp-' + random)
2. fsync временный файл (гарантия что данные на диске, не в кеше ОС)
3. rename временный файл → целевой файл (атомарная операция FS)
4. fsync директорию (гарантия что rename на диске)
```

Если обрыв на шагах 1-2: временный файл может быть битый, но целевой файл не тронут.
Если обрыв на шаге 3: rename атомарен — либо произошёл, либо нет.
Если обрыв на шаге 4: rename уже произошёл, fsync директории — дополнительная гарантия.

## Интерфейс

```typescript
async function atomicWriteFile(filePath: string, data: string): Promise<void>
async function atomicWriteJSON(filePath: string, data: unknown): Promise<void>
function atomicWriteFileSync(filePath: string, data: string): void
```

## Реализация

```typescript
import { writeFileSync, renameSync, openSync, fsyncSync, closeSync } from 'fs';
import { writeFile, rename, open } from 'fs/promises';
import { dirname, join } from 'path';
import { randomBytes } from 'crypto';

async function atomicWriteFile(filePath: string, data: string): Promise<void> {
  const dir = dirname(filePath);
  const tmpPath = join(dir, `.tmp-${randomBytes(8).toString('hex')}`);

  const fd = await open(tmpPath, 'w');
  try {
    await fd.writeFile(data, 'utf-8');
    await fd.sync();
  } finally {
    await fd.close();
  }

  await rename(tmpPath, filePath);

  const dirFd = await open(dir, 'r');
  try {
    await dirFd.sync();
  } finally {
    await dirFd.close();
  }
}

async function atomicWriteJSON(filePath: string, data: unknown): Promise<void> {
  const json = JSON.stringify(data, null, 2);
  await atomicWriteFile(filePath, json);
}
```

## Sync-версия

Для критических моментов (app.on('before-quit')) где async может не завершиться:

```typescript
function atomicWriteFileSync(filePath: string, data: string): void {
  const dir = dirname(filePath);
  const tmpPath = join(dir, `.tmp-${randomBytes(8).toString('hex')}`);

  writeFileSync(tmpPath, data, 'utf-8');
  const fd = openSync(tmpPath, 'r');
  fsyncSync(fd);
  closeSync(fd);
  renameSync(tmpPath, filePath);
}
```

## Ограничения

- rename атомарен только в пределах одной файловой системы
- На Windows rename может fail если файл заблокирован другим процессом (retry 3 раза с задержкой)
- fsync директории не поддерживается на всех ОС (graceful fallback)

## Тесты

- Записать файл → прочитать → содержимое совпадает
- Параллельная запись одного файла → последняя версия побеждает, файл не битый
- Симуляция краша (убить процесс после write, до rename) → старый файл цел
