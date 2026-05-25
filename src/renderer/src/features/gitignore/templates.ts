export interface GitignoreTemplate {
  name: string;
  content: string;
}

export type GitignoreCategory = 'os' | 'ide' | 'language';

export interface GitignoreCategoryGroup {
  category: GitignoreCategory;
  templates: GitignoreTemplate[];
}

const OS_TEMPLATES: GitignoreTemplate[] = [
  {
    name: 'Windows',
    content: `Thumbs.db
ehthumbs.db
Desktop.ini
$RECYCLE.BIN/
*.lnk`,
  },
  {
    name: 'macOS',
    content: `.DS_Store
.DS_Store?
._*
.Spotlight-V100
.Trashes
.AppleDouble
.LSOverride
Icon?`,
  },
  {
    name: 'Linux',
    content: `*~
.fuse_hidden*
.directory
.Trash-*
.nfs*`,
  },
];

const IDE_TEMPLATES: GitignoreTemplate[] = [
  {
    name: 'VS Code',
    content: `.vscode/*
!.vscode/settings.json
!.vscode/tasks.json
!.vscode/launch.json
!.vscode/extensions.json
*.code-workspace`,
  },
  {
    name: 'JetBrains',
    content: `.idea/
*.iml
*.iws
*.ipr
out/`,
  },
  {
    name: 'Cursor',
    content: `.cursor/
.cursor-tutor/`,
  },
  {
    name: 'Vim',
    content: `*.swp
*.swo
*.swn
Session.vim
.netrwhist`,
  },
  {
    name: 'Sublime Text',
    content: `*.sublime-workspace
*.sublime-project`,
  },
];

const LANGUAGE_TEMPLATES: GitignoreTemplate[] = [
  {
    name: 'Node.js',
    content: `node_modules/
dist/
build/
.env
.env.local
.env.*.local
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
.pnpm-debug.log*
.npm
.yarn-integrity
coverage/`,
  },
  {
    name: 'Python',
    content: `__pycache__/
*.py[cod]
*$py.class
*.so
.Python
.env
venv/
.venv/
env/
ENV/
dist/
build/
*.egg-info/
.eggs/
.mypy_cache/
.pytest_cache/
.coverage
htmlcov/`,
  },
  {
    name: 'Java',
    content: `*.class
*.jar
*.war
*.ear
target/
.gradle/
build/
hs_err_pid*
replay_pid*`,
  },
  {
    name: 'C/C++',
    content: `*.o
*.obj
*.so
*.dll
*.dylib
*.exe
*.out
*.a
*.la
*.lo
build/
cmake-build-*/
CMakeCache.txt
CMakeFiles/`,
  },
  {
    name: 'Rust',
    content: `/target
**/*.rs.bk
Cargo.lock`,
  },
  {
    name: 'Go',
    content: `*.exe
*.exe~
*.dll
*.so
*.dylib
*.test
*.out
vendor/`,
  },
  {
    name: 'C#/.NET',
    content: `bin/
obj/
*.user
*.suo
*.userprefs
.vs/
*.pdb
*.dll
[Dd]ebug/
[Rr]elease/`,
  },
  {
    name: 'Ruby',
    content: `*.gem
.bundle/
vendor/bundle/
log/
tmp/
.rspec_status
coverage/`,
  },
  {
    name: 'PHP',
    content: `/vendor/
composer.phar
.phpunit.result.cache
.env`,
  },
];

export const TEMPLATE_GROUPS: GitignoreCategoryGroup[] = [
  { category: 'os', templates: OS_TEMPLATES },
  { category: 'ide', templates: IDE_TEMPLATES },
  { category: 'language', templates: LANGUAGE_TEMPLATES },
];

export function findTemplate(name: string): GitignoreTemplate | undefined {
  for (const group of TEMPLATE_GROUPS) {
    const found = group.templates.find((tpl) => tpl.name === name);
    if (found) return found;
  }
  return undefined;
}

/** Дефолтный OS шаблон под текущую платформу (Windows/macOS/Linux). */
export function defaultOsTemplate(): string | null {
  if (typeof navigator === 'undefined') return null;
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('win')) return 'Windows';
  if (ua.includes('mac')) return 'macOS';
  if (ua.includes('linux')) return 'Linux';
  return null;
}

/**
 * Собирает финальный текст: каждый выбранный шаблон с заголовком-разделителем.
 * Если `existing` непустой — кладём его сверху и добавляем только те правила,
 * которых ещё нет в файле (line-level dedup, trim).
 */
export function buildContent(selectedNames: string[], existing = ''): string {
  const existingLines = new Set(
    existing
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean),
  );

  const blocks: string[] = [];
  if (existing.trim()) blocks.push(existing.trimEnd());

  for (const name of selectedNames) {
    const tpl = findTemplate(name);
    if (!tpl) continue;
    const newLines = tpl.content
      .split('\n')
      .filter((l) => l.trim() && !existingLines.has(l.trim()));
    if (newLines.length === 0) continue;
    blocks.push(`# ${name}\n${newLines.join('\n')}`);
    for (const l of newLines) existingLines.add(l.trim());
  }

  return blocks.join('\n\n') + '\n';
}
