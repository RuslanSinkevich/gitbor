export interface GitignoreTemplate {
  name: string;
  content: string;
}

export const TEMPLATES: GitignoreTemplate[] = [
  {
    name: 'Node.js',
    content: `node_modules/
dist/
build/
.env
.env.local
*.log
npm-debug.log*
.DS_Store
Thumbs.db`,
  },
  {
    name: 'Python',
    content: `__pycache__/
*.py[cod]
*$py.class
*.so
.env
venv/
.venv/
dist/
build/
*.egg-info/
.eggs/
.mypy_cache/`,
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
.idea/
*.iml
.DS_Store`,
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
build/
cmake-build-*/
.vscode/`,
  },
  {
    name: 'Rust',
    content: `/target
Cargo.lock
**/*.rs.bk`,
  },
  {
    name: 'Go',
    content: `*.exe
*.exe~
*.dll
*.so
*.dylib
*.test
vendor/`,
  },
  {
    name: 'IDE',
    content: `.idea/
.vscode/
*.swp
*.swo
*~
.DS_Store
Thumbs.db
*.suo
*.ntvs*
*.njsproj
*.sln
*.sw?`,
  },
  {
    name: 'OS',
    content: `.DS_Store
.DS_Store?
._*
.Spotlight-V100
.Trashes
ehthumbs.db
Thumbs.db
desktop.ini`,
  },
];
