import { useEffect, useState } from 'react';
import type { FileHistoryResult, FileHistoryEntry } from '../../types';
import { postCommand, onMainEvent } from '../../api';
import { t, tpl } from '../../i18n';
import { SgDialog } from '../../ui/SgDialog';
import { SgContextMenu, type SgContextMenuItem } from '../../ui/SgContextMenu';
import { DiffPanel } from '../diff';
import s from './FileHistoryModal.module.css';

interface Props {
  file: string;
  onClose: () => void;
}

function formatDate(ts: number): string {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * Модалка истории коммитов по файлу в стиле Visual Studio: слева список
 * коммитов, справа — наш обычный diff (DiffPanel). Состояние open/close
 * держится вызывающим (LocalChanges), НЕ через App. Backend не трогаем —
 * только вызываем getFileHistory/getFileDiff.
 */
export function FileHistoryModal({ file, onClose }: Props) {
  const loc = t();
  const [history, setHistory] = useState<FileHistoryResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [diffHash, setDiffHash] = useState<string | null>(null);
  const [compareLabel, setCompareLabel] = useState<string>('');
  // Взведённая база для «Сравнить с…»: следующий клик по коммиту станет
  // целью, покажем diff `base..target`.
  const [armedBase, setArmedBase] = useState<FileHistoryEntry | null>(null);
  // Собственное контекстное меню: модалка — <dialog> в top-layer, меню из
  // App.tsx рендерится в обычном DOM и оказалось бы ПОД модалкой. Поэтому
  // рендерим SgContextMenu внутри модалки (как useDiffCopyMenu).
  const [menu, setMenu] = useState<{ x: number; y: number; items: SgContextMenuItem[] } | null>(null);

  useEffect(() => {
    setLoading(true);
    setHistory(null);
    setSelectedHash(null);
    setDiffHash(null);
    setCompareLabel('');
    setArmedBase(null);

    const unsub = onMainEvent((msg) => {
      if (msg.type === 'fileHistory' && msg.file === file) {
        setHistory(msg.data);
        setLoading(false);
        const first = msg.data.entries[0];
        if (first) {
          setSelectedHash(first.hash);
          setDiffHash(`PREV:${first.hash}`);
          setCompareLabel(tpl(loc.fileHistoryModal.vsPrevious, { hash: first.shortHash }));
        }
      }
    });

    postCommand({ type: 'getFileHistory', file });
    return unsub;
  }, [file]);

  const showPrevious = (entry: FileHistoryEntry) => {
    setSelectedHash(entry.hash);
    setDiffHash(`PREV:${entry.hash}`);
    setCompareLabel(tpl(loc.fileHistoryModal.vsPrevious, { hash: entry.shortHash }));
    setArmedBase(null);
  };

  const showRange = (base: FileHistoryEntry, target: FileHistoryEntry) => {
    setSelectedHash(target.hash);
    setDiffHash(`${base.hash}..${target.hash}`);
    setCompareLabel(tpl(loc.fileHistoryModal.vsRange, { from: base.shortHash, to: target.shortHash }));
    setArmedBase(null);
  };

  const handleRowClick = (entry: FileHistoryEntry) => {
    if (armedBase && armedBase.hash !== entry.hash) {
      showRange(armedBase, entry);
    } else {
      showPrevious(entry);
    }
  };

  const openMenu = (e: React.MouseEvent, entry: FileHistoryEntry) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: loc.fileHistory.compareWithPrevious, action: () => showPrevious(entry) },
        { label: loc.fileHistoryModal.compareWithPick, action: () => setArmedBase(entry) },
      ],
    });
  };

  let body: React.ReactNode;
  if (loading) {
    body = <div className={s.empty}>{loc.fileHistory.loading}</div>;
  } else if (!history || history.entries.length === 0) {
    body = <div className={s.empty}>{loc.fileHistory.noHistory}</div>;
  } else {
    body = (
      <div className={s.root}>
        <div className={s.list}>
          <div className={s.listHeader}>
            {history.entries.length} {loc.fileHistory.commits}
          </div>
          <div className={s.listBody}>
            {history.entries.map((entry) => {
              const isSel = selectedHash === entry.hash;
              const isArmed = armedBase?.hash === entry.hash;
              return (
                <div
                  key={entry.hash}
                  className={`${s.entry} ${isSel ? s.entrySelected : ''} ${isArmed ? s.entryArmed : ''}`}
                  onClick={() => handleRowClick(entry)}
                  onContextMenu={(e) => openMenu(e, entry)}
                >
                  <div className={s.entryTop}>
                    <span className={s.entryHash}>{entry.shortHash}</span>
                    <span className={s.entrySubject}>{entry.subject}</span>
                  </div>
                  <div className={s.entryMeta}>
                    <span className={s.entryAuthor}>{entry.authorName}</span>
                    <span className={s.entryDate}>{formatDate(entry.authorDate)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className={s.right}>
          <div className={s.compareBar}>
            <span className={s.compareLabel}>{compareLabel}</span>
            {armedBase && (
              <span className={s.armedHint}>
                {tpl(loc.fileHistoryModal.armedHint, { hash: armedBase.shortHash })}
              </span>
            )}
          </div>
          <div className={s.diffWrap}>
            {diffHash
              ? <DiffPanel file={file} hash={diffHash} />
              : <div className={s.empty}>{loc.fileHistoryModal.selectCommit}</div>}
          </div>
        </div>
      </div>
    );
  }

  const title = `${loc.fileHistory.history}: ${file.split('/').pop() || file}`;

  return (
    <SgDialog open title={title} onClose={onClose} size="fullscreen" noPadding>
      {body}
      {menu && (
        <SgContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
      )}
    </SgDialog>
  );
}
