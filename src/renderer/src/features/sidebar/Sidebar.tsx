import { useState, useMemo, useCallback } from 'react';
import { t } from '../../i18n';
import { postCommand } from '../../api';
import type { Branch, Tag, Stash, Remote } from '../../types';
import type { SgContextMenuItem } from '../../ui/SgContextMenu';
import { getTagMenuItems, getStashMenuItems, getRemoteMenuItems } from './sidebarMenuItems';
import { buildBranchTree, countLeaves, BranchTreeItem } from './BranchTree';
import { SubmodulesList } from './SubmodulesList';
import type { ShowPrompt } from '../graph/commitMenuItems';
import s from './Sidebar.module.css';

interface Props {
  currentBranch: string;
  branches: Branch[];
  tags: Tag[];
  stashes: Stash[];
  remotes: Remote[];
  ahead: number;
  behind: number;
  stagedCount: number;
  unstagedCount: number;
  activeView?: 'changes' | 'commits';
  onContextMenu: (e: React.MouseEvent, items: SgContextMenuItem[]) => void;
  onSwitchView: (view: 'changes' | 'commits') => void;
  onSelectRef?: (hash: string) => void;
  onMerge?: (source: string) => void;
  showPrompt: ShowPrompt;
}

interface SectionState { branches: boolean; remotes: boolean; tags: boolean; stashes: boolean }

const ICONS = { branch: '⎇', remote: '☁', tag: '🏷', stash: '📦', changes: '●' } as const;

export function Sidebar({
  currentBranch, branches, tags, stashes, remotes,
  stagedCount, unstagedCount, activeView, onContextMenu, onSwitchView, onSelectRef, onMerge, showPrompt,
}: Props) {
  const loc = t();
  const [filter, setFilter] = useState('');
  const [sections, setSections] = useState<SectionState>({ branches: true, remotes: false, tags: false, stashes: false });
  const toggle = useCallback((key: keyof SectionState) => setSections(prev => ({ ...prev, [key]: !prev[key] })), []);

  const localBranches = useMemo(() => branches.filter(b => !b.isRemote), [branches]);
  const remoteBranches = useMemo(() => branches.filter(b => b.isRemote), [branches]);

  const lf = filter.toLowerCase();
  const filteredLocal = useMemo(() => lf ? localBranches.filter(b => b.name.toLowerCase().includes(lf)) : localBranches, [localBranches, lf]);
  const filteredRemote = useMemo(() => lf ? remoteBranches.filter(b => b.name.toLowerCase().includes(lf)) : remoteBranches, [remoteBranches, lf]);
  const filteredTags = useMemo(() => lf ? tags.filter(tg => tg.name.toLowerCase().includes(lf)) : tags, [tags, lf]);

  const localTree = useMemo(() => buildBranchTree(filteredLocal), [filteredLocal]);
  const totalChanges = stagedCount + unstagedCount;

  return (
    <div className={s.root}>
      <div className={`${s.navItem} ${activeView === 'changes' ? s.navItemActive : ''}`} onClick={() => onSwitchView('changes')}>
        <span className={s.navIcon}>{ICONS.changes}</span>
        <span className={s.navLabel}>{loc.sidebar.localChanges}</span>
        {totalChanges > 0 && <span className={s.navBadge}>{totalChanges}</span>}
      </div>
      <div className={`${s.navItem} ${activeView === 'commits' ? s.navItemActive : ''}`} onClick={() => onSwitchView('commits')}>
        <span className={s.navIcon}>☰</span>
        <span className={s.navLabel}>{loc.sidebar.allCommits}</span>
      </div>

      <div className={s.navDivider} />

      <div className={s.filter}>
        <input className={s.filterInput} type="text" placeholder={loc.sidebar.filter} value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>

      <SidebarSection title={loc.sidebar.branches} icon={ICONS.branch} count={filteredLocal.length} expanded={sections.branches} onToggle={() => toggle('branches')}>
        {filteredLocal.length === 0 && <div className={s.emptySection}>{filter ? loc.sidebar.noMatches : loc.sidebar.noBranches}</div>}
        {localTree.map(node => (
          <BranchTreeItem key={node.fullPath} node={node} depth={0} nested={false} currentBranch={currentBranch} loc={loc} onContextMenu={onContextMenu} onSelectRef={onSelectRef} onMerge={onMerge} showPrompt={showPrompt} />
        ))}
      </SidebarSection>

      <SidebarSection title={loc.sidebar.remotes} icon={ICONS.remote} count={remotes.length} expanded={sections.remotes} onToggle={() => toggle('remotes')}>
        {remotes.length === 0 && <div className={s.emptySection}>{loc.sidebar.noRemotes}</div>}
        {remotes.map(remote => {
          const remoteBranchesForRemote = filteredRemote.filter(b => b.name.startsWith(remote.name + '/'));
          const remoteTree = buildBranchTree(remoteBranchesForRemote, remote.name + '/');
          return (
            <RemoteFolder key={remote.name} remote={remote} tree={remoteTree} currentBranch={currentBranch}
              loc={loc} onContextMenu={onContextMenu} onSelectRef={onSelectRef} onMerge={onMerge} showPrompt={showPrompt} />
          );
        })}
      </SidebarSection>

      <SidebarSection title={loc.sidebar.tags} icon={ICONS.tag} count={filteredTags.length} expanded={sections.tags} onToggle={() => toggle('tags')}>
        {filteredTags.length === 0 && <div className={s.emptySection}>{filter ? loc.sidebar.noMatches : loc.sidebar.noTags}</div>}
        {filteredTags.map(tag => (
          <div key={tag.name} className={s.item}
            onClick={() => onSelectRef?.(tag.hash)}
            onDoubleClick={() => postCommand({ type: 'checkout', branch: tag.name })}
            onContextMenu={(e) => { e.preventDefault(); onContextMenu(e, getTagMenuItems(tag, loc, showPrompt)); }}>
            <span className={s.itemName}>{tag.name}</span>
          </div>
        ))}
      </SidebarSection>

      <SidebarSection title={loc.sidebar.stashes} icon={ICONS.stash} count={stashes.length} expanded={sections.stashes} onToggle={() => toggle('stashes')}>
        {stashes.length === 0 && <div className={s.emptySection}>{loc.sidebar.noStashes}</div>}
        {stashes.map(stash => (
          <div key={stash.index} className={s.item}
            onClick={() => onSelectRef?.(stash.hash)}
            onContextMenu={(e) => { e.preventDefault(); onContextMenu(e, getStashMenuItems(stash, loc, showPrompt)); }}>
            <span className={s.itemName}>{stash.message || `stash@{${stash.index}}`}</span>
          </div>
        ))}
      </SidebarSection>

      <SubmodulesList />
    </div>
  );
}

/* ─── Sub-components ─── */

function RemoteFolder({ remote, tree, currentBranch, loc, onContextMenu, onSelectRef, onMerge, showPrompt }: {
  remote: Remote; tree: ReturnType<typeof buildBranchTree>; currentBranch: string;
  loc: ReturnType<typeof t>; onContextMenu: Props['onContextMenu']; onSelectRef?: (hash: string) => void; onMerge?: (source: string) => void; showPrompt: ShowPrompt;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <div className={s.treeFolder} style={{ paddingLeft: 20 }} onClick={() => setExpanded(e => !e)}
        onContextMenu={(e) => { e.preventDefault(); onContextMenu(e, getRemoteMenuItems(remote, loc, showPrompt)); }}>
        <span className={`${s.arrow} ${expanded ? s.arrowExpanded : ''}`}>&#9656;</span>
        <span className={s.treeFolderIcon}>☁</span>
        <span className={s.treeFolderName}>{remote.name}</span>
        <span className={s.treeFolderCount}>{tree.reduce((sum, n) => sum + countLeaves(n), 0)}</span>
      </div>
      {expanded && (
        <div className={s.treeChildren}>
          {tree.map(node => (
            <BranchTreeItem key={node.fullPath} node={node} depth={0} nested currentBranch={currentBranch} loc={loc}
              onContextMenu={onContextMenu} onSelectRef={onSelectRef} onMerge={onMerge} showPrompt={showPrompt} />
          ))}
        </div>
      )}
    </>
  );
}

function SidebarSection({ title, icon, count, expanded, onToggle, children }: {
  title: string; icon: string; count: number; expanded: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div className={s.section}>
      <div className={s.sectionHeader} onClick={onToggle}>
        <span className={`${s.arrow} ${expanded ? s.arrowExpanded : ''}`}>&#9656;</span>
        <span className={s.sectionIcon}>{icon}</span>
        <span className={s.sectionTitle}>{title}</span>
        <span className={s.sectionCount}>{count}</span>
      </div>
      {expanded && <div className={s.sectionBody}>{children}</div>}
    </div>
  );
}
