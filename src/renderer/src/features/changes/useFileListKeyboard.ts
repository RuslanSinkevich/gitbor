import { useState, useCallback, useMemo, type KeyboardEvent } from 'react';
import type { FileStatus } from '../../types';

type Section = 'unstaged' | 'staged' | 'conflict';

interface FlatEntry {
  file: FileStatus;
  section: Section;
}

export function useFileListKeyboard(
  normalUnstaged: FileStatus[],
  stagedFiles: FileStatus[],
  conflictFiles: FileStatus[],
  hasConflicts: boolean,
  onClickFile: (file: FileStatus, section: Section) => void,
  onToggleStage: (file: FileStatus, section: Section) => void,
) {
  const [focusedIdx, setFocusedIdx] = useState(-1);

  const flatList = useMemo(() => {
    const list: FlatEntry[] = [];
    if (hasConflicts) {
      for (const f of conflictFiles) list.push({ file: f, section: 'conflict' });
    }
    for (const f of normalUnstaged) list.push({ file: f, section: 'unstaged' });
    for (const f of stagedFiles) list.push({ file: f, section: 'staged' });
    return list;
  }, [normalUnstaged, stagedFiles, conflictFiles, hasConflicts]);

  const focusedPath = focusedIdx >= 0 && focusedIdx < flatList.length
    ? flatList[focusedIdx].file.path
    : null;

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (flatList.length === 0) return;

    if (e.key === 'ArrowDown' || e.key === 'j') {
      e.preventDefault();
      setFocusedIdx(prev => Math.min(prev + 1, flatList.length - 1));
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'k') {
      e.preventDefault();
      setFocusedIdx(prev => Math.max(prev - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (focusedIdx >= 0 && focusedIdx < flatList.length) {
        const entry = flatList[focusedIdx];
        onClickFile(entry.file, entry.section);
      }
      return;
    }
    if (e.key === ' ') {
      e.preventDefault();
      if (focusedIdx >= 0 && focusedIdx < flatList.length) {
        const entry = flatList[focusedIdx];
        onToggleStage(entry.file, entry.section);
      }
      return;
    }
    if (e.key === 'Home') {
      e.preventDefault();
      setFocusedIdx(0);
      return;
    }
    if (e.key === 'End') {
      e.preventDefault();
      setFocusedIdx(flatList.length - 1);
    }
  }, [flatList, focusedIdx, onClickFile, onToggleStage]);

  return { focusedIdx, focusedPath, handleKeyDown, setFocusedIdx, flatList };
}
