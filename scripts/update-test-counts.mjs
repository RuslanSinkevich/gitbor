// Обновляет счётчики тестов в документации: прогоняет Vitest с JSON-репортером
// и переписывает содержимое маркеров
//   <!-- TESTS_COUNT -->N<!-- /TESTS_COUNT -->   — всего тестов
//   <!-- TESTS_FILES -->N<!-- /TESTS_FILES -->   — файлов с тестами
//   <!-- TESTS_TABLE_RU --> … <!-- /TESTS_TABLE_RU -->  — таблица «папка → файлов / тестов»
//   <!-- TESTS_TABLE_EN --> … <!-- /TESTS_TABLE_EN -->
// Запуск: `npm run docs:counts`. Числа в доках руками не правим.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';

const root = process.cwd();
const DOCS = [
  'README.md',
  'docs/contributing.md',
  'docs/testing.md',
  'docs/en/README.md',
  'docs/en/contributing.md',
  'docs/en/testing.md',
];

const tmp = mkdtempSync(join(tmpdir(), 'gitbor-tests-'));
const out = join(tmp, 'vitest.json');
// Одной строкой через shell: на Windows npx — это .cmd, и Node без shell его
// не запускает, а массив аргументов вместе с shell:true даёт DEP0190.
const run = spawnSync(`npx vitest run --reporter=json "--outputFile=${out}"`, {
  stdio: ['ignore', 'ignore', 'inherit'],
  shell: true,
});
let report;
try {
  report = JSON.parse(readFileSync(out, 'utf8'));
} catch {
  console.error('update-test-counts: не удалось прочитать отчёт Vitest');
  process.exit(run.status || 1);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

const total = report.numTotalTests;
const files = report.testResults.length;

// Группировка по первой папке внутри tests/ (файлы в корне tests/ — «(корень)»).
const byDir = new Map();
for (const r of report.testResults) {
  const rel = relative(join(root, 'tests'), r.name).split(sep);
  const dir = rel.length > 1 ? rel[0] : '';
  const cur = byDir.get(dir) ?? { files: 0, tests: 0 };
  cur.files += 1;
  cur.tests += r.assertionResults.length;
  byDir.set(dir, cur);
}
const rows = [...byDir.entries()].sort((a, b) => b[1].tests - a[1].tests);
// Пустые строки вокруг таблицы — чтобы Markdown не склеил её с маркерами-комментариями.
const table = (head, rootName, totalName) => [
  '',
  '',
  head,
  '|---|---:|---:|',
  ...rows.map(([d, v]) => `| ${d ? '`tests/' + d + '/`' : rootName} | ${v.files} | ${v.tests} |`),
  `| **${totalName}** | **${files}** | **${total}** |`,
  '',
  '',
].join('\n');
const tableRu = table('| Папка | Файлов | Тестов |', '`tests/` (корень)', 'Итого');
const tableEn = table('| Folder | Files | Tests |', '`tests/` (root)', 'Total');

const replaceMarker = (text, name, value) =>
  text.replace(new RegExp(`(<!-- ${name} -->)[\\s\\S]*?(<!-- /${name} -->)`, 'g'), `$1${value}$2`);

for (const doc of DOCS) {
  const path = join(root, doc);
  const before = readFileSync(path, 'utf8');
  let text = replaceMarker(before, 'TESTS_COUNT', String(total));
  text = replaceMarker(text, 'TESTS_FILES', String(files));
  text = replaceMarker(text, 'TESTS_TABLE_RU', tableRu);
  text = replaceMarker(text, 'TESTS_TABLE_EN', tableEn);
  if (text !== before) {
    writeFileSync(path, text);
    console.log(`update-test-counts: ${doc}`);
  }
}
console.log(`update-test-counts: ${total} тестов в ${files} файлах`);
if (run.status !== 0) {
  console.error('update-test-counts: часть тестов упала — числа записаны, но проверь прогон');
  process.exit(run.status);
}
