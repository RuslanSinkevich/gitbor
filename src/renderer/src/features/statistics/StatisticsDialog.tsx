import { useState, useEffect, useRef, useCallback } from 'react';
import { postCommand, onMainEvent } from '../../api';
import { t } from '../../i18n';
import type { RepoStats, AuthorStats, AuthorCodeStatsResult } from '../../types';
import { OverviewView } from './OverviewView';
import { AuthorDetailView } from './AuthorDetailView';
import s from './Statistics.module.css';

interface Props {
  onClose: () => void;
}

export function StatisticsDialog({ onClose }: Props) {
  const loc = t();
  const sl = loc.stats;
  const [data, setData] = useState<RepoStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedAuthor, setSelectedAuthor] = useState<AuthorStats | null>(null);
  const [authorCodeStats, setAuthorCodeStats] = useState<AuthorCodeStatsResult | null>(null);
  const [authorCodeStatsLoading, setAuthorCodeStatsLoading] = useState(false);
  const selectedAuthorKeyRef = useRef('');
  /** True from «Calculate» click until `authorCodeStats` or an error clears loading. */
  const pendingAuthorCodeStatsRef = useRef(false);

  const authorKey = useCallback((authorName: string, authorEmail: string) => `${authorName}\x00${authorEmail}`, []);

  useEffect(() => {
    const unsub = onMainEvent((msg) => {
      if (msg.type === 'repoStats') {
        setData(msg.data);
        setLoading(false);
        return;
      }
      if (msg.type === 'authorCodeStats') {
        if (selectedAuthorKeyRef.current !== authorKey(msg.data.authorName, msg.data.authorEmail)) return;
        pendingAuthorCodeStatsRef.current = false;
        setAuthorCodeStats(msg.data);
        setAuthorCodeStatsLoading(false);
        return;
      }
      if (msg.type === 'error' && pendingAuthorCodeStatsRef.current) {
        pendingAuthorCodeStatsRef.current = false;
        setAuthorCodeStatsLoading(false);
      }
    });
    postCommand({ type: 'getRepoStats' });
    return unsub;
  }, [authorKey]);

  useEffect(() => {
    if (!selectedAuthor) {
      selectedAuthorKeyRef.current = '';
      pendingAuthorCodeStatsRef.current = false;
      setAuthorCodeStats(null);
      setAuthorCodeStatsLoading(false);
      return;
    }
    selectedAuthorKeyRef.current = authorKey(selectedAuthor.name, selectedAuthor.email);
    pendingAuthorCodeStatsRef.current = false;
    setAuthorCodeStats(null);
    setAuthorCodeStatsLoading(false);
  }, [selectedAuthor, authorKey]);

  const handleBack = () => setSelectedAuthor(null);
  const handleCalculateCodeStats = useCallback((force?: boolean) => {
    if (!selectedAuthor) return;
    selectedAuthorKeyRef.current = authorKey(selectedAuthor.name, selectedAuthor.email);
    pendingAuthorCodeStatsRef.current = true;
    setAuthorCodeStatsLoading(true);
    postCommand(
      {
        type: 'getAuthorCodeStats',
        authorName: selectedAuthor.name,
        authorEmail: selectedAuthor.email,
        force: force || undefined,
      },
      {
        onInvokeRejected: () => {
          if (pendingAuthorCodeStatsRef.current) {
            pendingAuthorCodeStatsRef.current = false;
            setAuthorCodeStatsLoading(false);
          }
        },
      },
    );
  }, [selectedAuthor, authorKey]);

  return (
    <div className={s.overlay} onClick={onClose}>
      <div className={s.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={s.header}>
          {selectedAuthor && (
            <button className={s.backBtn} onClick={handleBack}>&larr; {sl.back}</button>
          )}
          <div className={s.headerText}>
            <h2 className={s.title}>
              {selectedAuthor ? selectedAuthor.name : sl.title}
            </h2>
            <p className={s.subtitle}>
              {selectedAuthor ? selectedAuthor.email : sl.subtitle}
            </p>
          </div>
        </div>

        <div className={s.body}>
          {loading && <div className={s.loading}>{loc.app.loading}</div>}
          {!loading && !data && <div className={s.empty}>{sl.noData}</div>}
          {!loading && data && !selectedAuthor && (
            <OverviewView data={data} onSelectAuthor={setSelectedAuthor} />
          )}
          {!loading && data && selectedAuthor && (
            <AuthorDetailView
              author={selectedAuthor}
              codeStats={authorCodeStats}
              codeStatsLoading={authorCodeStatsLoading}
              onCalculateCodeStats={handleCalculateCodeStats}
            />
          )}
        </div>

        <div className={s.footer}>
          <button className={s.btnSecondary} onClick={onClose}>{sl.close}</button>
        </div>
      </div>
    </div>
  );
}
