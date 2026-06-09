import { useCallback, useRef, useState } from 'react';
import { postCommand } from '../api';

interface UseFolderDropOpenReposOptions {
  addToast: (message: string, kind?: 'info' | 'success' | 'warning' | 'error') => void;
  onlyFoldersMessage: string;
}

export function useFolderDropOpenRepos({
  addToast,
  onlyFoldersMessage,
}: UseFolderDropOpenReposOptions) {
  const [isDraggingFolder, setIsDraggingFolder] = useState(false);
  const dragDepthRef = useRef(0);

  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files');

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }, []);

  // dragenter/dragleave стреляют при движении внутри детей, поэтому считаем глубину.
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepthRef.current += 1;
    if (dragDepthRef.current === 1) setIsDraggingFolder(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDraggingFolder(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragDepthRef.current = 0;
    setIsDraggingFolder(false);

    const items = e.dataTransfer ? Array.from(e.dataTransfer.items) : [];
    const folderPaths: string[] = [];
    let droppedFiles = 0;
    for (const item of items) {
      if (item.kind !== 'file') continue;
      const entry = item.webkitGetAsEntry?.();
      const file = item.getAsFile();
      // Electron-specific: у File из ОС-перетаскивания есть .path (абсолютный).
      const fsPath = (file as (File & { path?: string }) | null)?.path;
      if (entry?.isDirectory && fsPath) {
        folderPaths.push(fsPath);
      } else {
        droppedFiles += 1;
      }
    }

    if (folderPaths.length === 0) {
      if (droppedFiles > 0) addToast(onlyFoldersMessage, 'info');
      return;
    }
    for (const p of folderPaths) {
      postCommand({ type: 'openRepo', path: p });
    }
  }, [addToast, onlyFoldersMessage]);

  return {
    isDraggingFolder,
    handleDragOver,
    handleDragEnter,
    handleDragLeave,
    handleDrop,
  };
}
