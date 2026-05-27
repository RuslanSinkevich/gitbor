import { useState, useMemo, useCallback, useEffect } from 'react';
import { t } from '../../i18n';
import type { Branch, Tag, Stash, Remote } from '../../types';
import type { RequestCheckout } from '../checkout';
import type { RequestApplyStash } from '../stash';
import { isAutoStash } from '../stash';
import type { SgContextMenuItem } from '../../ui/SgContextMenu';
import { getTagMenuItems, getStashMenuItems, getRemoteMenuItems } from './sidebarMenuItems';
import {
  buildBranchTree, countLeaves, BranchTreeItem,
  type BranchFolderExpand, type BranchPrefsAPI,
} from './BranchTree';
import { postCommand } from '../../api';
import { SubmodulesList } from './SubmodulesList';
import type { ShowPrompt } from '../graph/commitMenuItems';
import { loadSidebarSections, saveSidebarSections, loadBranchFolderExpanded, saveBranchFolderExpanded } from './sidebarPersist';
import s from './Sidebar.module.css';

interface Props {
  repoPath: string;
  currentBranch: string;
  branches: Branch[];
  tags: Tag[];
  stashes: Stash[];
  remotes: Remote[];
  ahead: number;
  behind: number;
  localChangesCount: number;
  activeView?: 'changes' | 'commits';
  onContextMenu: (e: React.MouseEvent, items: SgContextMenuItem[]) => void;
  onSwitchView: (view: 'changes' | 'commits') => void;
  onSelectRef?: (hash: string) => void;
  onMerge?: (source: string) => void;
  showPrompt: ShowPrompt;
  requestCheckout: RequestCheckout;
  requestApplyStash: RequestApplyStash;
  /** Хеш текущего выбранного ref (для подсветки активного stash). */
  selectedRefHash?: string | null;
  /** Per-repo prefs для pin/solo/hide/info (создаётся в App.tsx через useBranchPrefs).
      Если не передан — иконки на ветках не рендерятся. */
  branchPrefs?: BranchPrefsAPI;
}

interface SectionState { branches: boolean; remotes: boolean; tags: boolean; stashes: boolean }

const ICONS = { branch: '⎇', remote: '☁', tag: '🏷', stash: '📦', changes: '●' } as const;

export function Sidebar({
  repoPath, currentBranch, branches, tags, stashes, remotes,
  localChangesCount, activeView, onContextMenu, onSwitchView, onSelectRef, onMerge, showPrompt, requestCheckout,
  requestApplyStash, selectedRefHash, branchPrefs,
}: Props) {
  const loc = t();
  const [filter, setFilter] = useState('');
  const [sections, setSections] = useState<SectionState>(() => {
    const p = loadSidebarSections();
    return {
      branches: p?.branches ?? true,
      remotes: p?.remotes ?? false,
      tags: p?.tags ?? false,
      stashes: p?.stashes ?? false,
    };
  });
  const toggleSection = useCallback((key: keyof SectionState) => {
    setSections(prev => {
      const next = { ...prev, [key]: !prev[key] };
      saveSidebarSections(next);
      return next;
    });
  }, []);

  const [branchFoldersExpanded, setBranchFoldersExpanded] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!repoPath) {
      setBranchFoldersExpanded(new Set());
      return;
    }
    const saved = loadBranchFolderExpanded(repoPath, '');
    if (saved !== null) {
      setBranchFoldersExpanded(new Set(saved));
      return;
    }
    // Первый запуск без истории: все папки локальных веток свёрнуты.
    setBranchFoldersExpanded(new Set());
  }, [repoPath]);

  const folderExpandLocal = useMemo<BranchFolderExpand>(() => ({
    isExpanded: (fullPath: string) => branchFoldersExpanded.has(fullPath),
    toggle: (fullPath: string) => {
      setBranchFoldersExpanded(prev => {
        const next = new Set(prev);
        if (next.has(fullPath)) next.delete(fullPath);
        else next.add(fullPath);
        saveBranchFolderExpanded(repoPath, next, '');
        return next;
      });
    },
  }), [repoPath, branchFoldersExpanded]);

  const localBranches = useMemo(() => branches.filter(b => !b.isRemote), [branches]);
  const remoteBranches = useMemo(() => branches.filter(b => b.isRemote), [branches]);

  const lf = filter.toLowerCase();
  const filteredLocal = useMemo(() => lf ? localBranches.filter(b => b.name.toLowerCase().includes(lf)) : localBranches, [localBranches, lf]);
  const filteredRemote = useMemo(() => lf ? remoteBranches.filter(b => b.name.toLowerCase().includes(lf)) : remoteBranches, [remoteBranches, lf]);
  const filteredTags = useMemo(() => lf ? tags.filter(tg => tg.name.toLowerCase().includes(lf)) : tags, [tags, lf]);

  const localTree = useMemo(
    () => buildBranchTree(filteredLocal, '', branchPrefs?.pinned),
    [filteredLocal, branchPrefs?.pinned],
  );

  const handleBranchMove = useCallback((oldName: string, newName: string) => {
    if (oldName === newName) return;
    showPrompt({
      title: loc.sidebar.moveBranch ?? 'Move branch',
      label: (loc.sidebar.moveBranchPrompt ?? 'New name for {old}:').replace('{old}', oldName),
      defaultValue: newName,
      onConfirm: (finalName) => {
        if (finalName && finalName !== oldName) {
          postCommand({ type: 'renameBranch', oldName, newName: finalName });
        }
      },
    });
  }, [showPrompt, loc.sidebar]);

  // На больших репо (сотни remote-branches за 5 лет) buildBranchTree +
  // sortBranchTreeNodes с localeCompare — десятки/сотни мс. Строим дерево
  // ТОЛЬКО когда секция remotes раскрыта; свёрнутая секция не платит
  // за вычисления. И мемоизируем по входам — без этого рендер Sidebar на
  // каждый setState (а он прилетает часто) перестраивал дерево заново.
  const remoteEntries = useMemo(() => {
    if (!sections.remotes) return [];
    return remotes.map(remote => {
      const prefix = remote.name + '/';
      const remoteBranchesForRemote = filteredRemote.filter(b => b.name.startsWith(prefix));
      const remoteTree = buildBranchTree(remoteBranchesForRemote, prefix);
      const remoteBranchSig = remoteBranchesForRemote.map(b => b.name).join('\n');
      return { remote, remoteTree, remoteBranchSig };
    });
  }, [remotes, filteredRemote, sections.remotes]);

  return (
    <div className={s.root} data-testid="sidebar">
      <div className={`${s.navItem} ${activeView === 'changes' ? s.navItemActive : ''}`} onClick={() => onSwitchView('changes')}>
        <span className={s.navIcon}>{ICONS.changes}</span>
        <span className={s.navLabel}>{loc.sidebar.localChanges}</span>
        {localChangesCount > 0 && <span className={s.navBadge}>{localChangesCount}</span>}
      </div>
      <div className={`${s.navItem} ${activeView === 'commits' ? s.navItemActive : ''}`} onClick={() => onSwitchView('commits')}>
        <span className={s.navIcon}>☰</span>
        <span className={s.navLabel}>{loc.sidebar.allCommits}</span>
      </div>

      <div className={s.navDivider} />

      <div className={s.filter}>
        <input className={s.filterInput} type="text" placeholder={loc.sidebar.filter} value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>

      <SidebarSection title={loc.sidebar.branches} icon={ICONS.branch} count={filteredLocal.length} expanded={sections.branches} onToggle={() => toggleSection('branches')}>
        {filteredLocal.length === 0 && <div className={s.emptySection}>{filter ? loc.sidebar.noMatches : loc.sidebar.noBranches}</div>}
        {localTree.map(node => (
          <BranchTreeItem key={node.fullPath} node={node} depth={0} nested={false} currentBranch={currentBranch} loc={loc} onContextMenu={onContextMenu} onSelectRef={onSelectRef} onMerge={onMerge} showPrompt={showPrompt} requestCheckout={requestCheckout} folderExpand={folderExpandLocal} onBranchMove={handleBranchMove} prefs={branchPrefs} />
        ))}
      </SidebarSection>

      <SidebarSection title={loc.sidebar.remotes} icon={ICONS.remote} count={remotes.length} expanded={sections.remotes} onToggle={() => toggleSection('remotes')}>
        {remotes.length === 0 && <div className={s.emptySection}>{loc.sidebar.noRemotes}</div>}
        {remoteEntries.map(({ remote, remoteTree, remoteBranchSig }) => (
          <RemoteFolder key={remote.name} repoPath={repoPath} remote={remote} tree={remoteTree} remoteBranchSig={remoteBranchSig}
            currentBranch={currentBranch}
            loc={loc} onContextMenu={onContextMenu} onSelectRef={onSelectRef} onMerge={onMerge} showPrompt={showPrompt} requestCheckout={requestCheckout} />
        ))}
      </SidebarSection>

      <SidebarSection title={loc.sidebar.tags} icon={ICONS.tag} count={filteredTags.length} expanded={sections.tags} onToggle={() => toggleSection('tags')}>
        {filteredTags.length === 0 && <div className={s.emptySection}>{filter ? loc.sidebar.noMatches : loc.sidebar.noTags}</div>}
        {filteredTags.map(tag => (
          <div key={tag.name} className={s.item}
            onClick={() => onSelectRef?.(tag.hash)}
            onDoubleClick={() => requestCheckout(tag.name)}
            onContextMenu={(e) => { e.preventDefault(); onContextMenu(e, getTagMenuItems(tag, loc, showPrompt, requestCheckout)); }}>
            <span className={s.itemName}>{tag.name}</span>
          </div>
        ))}
      </SidebarSection>

      <SidebarSection title={loc.sidebar.stashes} icon={ICONS.stash} count={stashes.length} expanded={sections.stashes} onToggle={() => toggleSection('stashes')}>
        {stashes.length === 0 && <div className={s.emptySection}>{loc.sidebar.noStashes}</div>}
        {stashes.filter(st => !isAutoStash(st)).map(stash => (
          <StashItem
            key={stash.index}
            stash={stash}
            loc={loc}
            active={!!selectedRefHash && selectedRefHash === stash.hash}
            onSelect={() => onSelectRef?.(stash.hash)}
            onApply={() => requestApplyStash(stash)}
            onContextMenu={(e) => { e.preventDefault(); onContextMenu(e, getStashMenuItems(stash, loc, showPrompt, requestApplyStash)); }}
          />
        ))}
        {stashes.some(isAutoStash) && (
          <>
            <div className={s.autoStashGroupHeader}>{loc.stashDialog.autoStashGroup}</div>
            {stashes.filter(isAutoStash).map(stash => (
              <StashItem
                key={stash.index}
                stash={stash}
                loc={loc}
                active={!!selectedRefHash && selectedRefHash === stash.hash}
                autoBadge
                onSelect={() => onSelectRef?.(stash.hash)}
                onApply={() => requestApplyStash(stash)}
                onContextMenu={(e) => { e.preventDefault(); onContextMenu(e, getStashMenuItems(stash, loc, showPrompt, requestApplyStash)); }}
              />
            ))}
          </>
        )}
      </SidebarSection>

      <SubmodulesList />
    </div>
  );
}

/* ─── Sub-components ─── */

interface StashItemProps {
  stash: Stash;
  loc: ReturnType<typeof t>;
  active: boolean;
  autoBadge?: boolean;
  onSelect(): void;
  onApply(): void;
  onContextMenu(e: React.MouseEvent): void;
}

function stripStashBranch(msg: string): string {
  return msg.replace(/^On [^:]+:\s*/, '');
}

function StashItem({ stash, loc, active, autoBadge, onSelect, onApply, onContextMenu }: StashItemProps) {
  const fullMsg = stash.message || `stash@{${stash.index}}`;
  const displayMsg = stripStashBranch(stash.message) || `stash@{${stash.index}}`;
  return (
    <div
      className={`${s.item} ${active ? s.itemCurrent : ''}`}
      onClick={onSelect}
      onDoubleClick={onApply}
      onContextMenu={onContextMenu}
      title={fullMsg}
    >
      <span className={s.itemName}>{displayMsg}</span>
      {autoBadge && (
        <span className={s.itemUpstream} title={loc.stashDialog.autoStashBadge}>
          {loc.stashDialog.autoStashBadge}
        </span>
      )}
    </div>
  );
}


function RemoteFolder({ repoPath, remote, tree, remoteBranchSig, currentBranch, loc, onContextMenu, onSelectRef, onMerge, showPrompt, requestCheckout }: {
  repoPath: string;
  remote: Remote; tree: ReturnType<typeof buildBranchTree>; remoteBranchSig: string; currentBranch: string;
  loc: ReturnType<typeof t>; onContextMenu: Props['onContextMenu']; onSelectRef?: (hash: string) => void; onMerge?: (source: string) => void; showPrompt: ShowPrompt; requestCheckout: RequestCheckout;
}) {
  const [expanded, setExpanded] = useState(false);
  const [innerFolders, setInnerFolders] = useState<Set<string>>(() => {
    const saved = loadBranchFolderExpanded(repoPath, remote.name);
    if (saved !== null) return new Set(saved);
    return new Set();
  });

  useEffect(() => {
    const saved = loadBranchFolderExpanded(repoPath, remote.name);
    if (saved !== null) setInnerFolders(new Set(saved));
    else setInnerFolders(new Set());
  }, [repoPath, remote.name, remoteBranchSig]);

  const folderExpandRemote = useMemo<BranchFolderExpand>(() => ({
    isExpanded: (fullPath: string) => innerFolders.has(fullPath),
    toggle: (fullPath: string) => {
      setInnerFolders(prev => {
        const next = new Set(prev);
        if (next.has(fullPath)) next.delete(fullPath);
        else next.add(fullPath);
        saveBranchFolderExpanded(repoPath, next, remote.name);
        return next;
      });
    },
  }), [repoPath, remote.name, innerFolders]);

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
              onContextMenu={onContextMenu} onSelectRef={onSelectRef} onMerge={onMerge} showPrompt={showPrompt} requestCheckout={requestCheckout} folderExpand={folderExpandRemote} />
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
