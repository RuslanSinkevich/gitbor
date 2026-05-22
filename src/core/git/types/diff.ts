export interface DiffLine {
  type: 'add' | 'remove' | 'context';
  content: string;
  oldLineNo: number | null;
  newLineNo: number | null;
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

export interface FileDiff {
  path: string;
  oldPath?: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied';
  hunks: DiffHunk[];
  isBinary: boolean;
  /**
   * Stat-dirty: файл tracked, git status пометил как `M`, но реальных
   * изменений нет (mtime потрогана внешним инструментом — format-on-save,
   * Cursor и т.п.). Renderer показывает пустой стейт с подсказкой
   * и кнопкой «Refresh index», а не «новый файл».
   */
  statDirty?: boolean;
}

export interface BlameLine {
  hash: string;
  author: string;
  authorDate: number;
  lineNo: number;
  content: string;
  summary: string;
}

export interface BlameResult {
  path: string;
  lines: BlameLine[];
}

export interface FileHistoryEntry {
  hash: string;
  shortHash: string;
  subject: string;
  authorName: string;
  authorDate: number;
  status: string;
}

export interface FileHistoryResult {
  path: string;
  entries: FileHistoryEntry[];
}
