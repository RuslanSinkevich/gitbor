import { useEffect, useState } from 'react';
import { t } from '../../i18n';
import type { Submodule } from '../../types';
import { postCommand, onMainEvent } from '../../api';
import s from './Sidebar.module.css';

const STATUS_ICON: Record<string, string> = {
  modified: '●',
  uninitialized: '○',
  clean: '◉',
};

export function SubmodulesList() {
  const loc = t();
  const [submodules, setSubmodules] = useState<Submodule[]>([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const unsub = onMainEvent((msg) => {
      if (msg.type === 'submodules') {
        setSubmodules(msg.data);
      }
      if (msg.type === 'operationEnd' && (msg.operation === 'submoduleInit' || msg.operation === 'submoduleUpdate')) {
        postCommand({ type: 'getSubmodules' });
      }
    });
    postCommand({ type: 'getSubmodules' });
    return unsub;
  }, []);

  if (submodules.length === 0) return null;

  return (
    <div className={s.section}>
      <div className={s.sectionHeader} onClick={() => setExpanded(e => !e)}>
        <span className={`${s.arrow} ${expanded ? s.arrowExpanded : ''}`}>&#9656;</span>
        <span className={s.sectionIcon}>📦</span>
        <span className={s.sectionTitle}>{loc.sidebar.submodules}</span>
        <span className={s.sectionCount}>{submodules.length}</span>
      </div>
      {expanded && (
        <div className={s.sectionBody}>
          {submodules.map(sm => (
            <div key={sm.path} className={s.item} title={sm.url || sm.path}>
              <span className={s.itemName}>
                {STATUS_ICON[sm.status] || '?'} {sm.name}
              </span>
              {sm.status === 'uninitialized' && (
                <button
                  className={s.itemBadge}
                  onClick={(e) => { e.stopPropagation(); postCommand({ type: 'submoduleInit', path: sm.path }); }}
                >
                  {loc.submodules.init}
                </button>
              )}
              {sm.status === 'modified' && (
                <button
                  className={s.itemBadge}
                  onClick={(e) => { e.stopPropagation(); postCommand({ type: 'submoduleUpdate', path: sm.path }); }}
                >
                  {loc.submodules.update}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
