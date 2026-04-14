import { useState, useEffect } from 'react';
import { postCommand, onMainEvent } from '../../api';
import { t } from '../../i18n';
import type { RepoStats, AuthorStats } from '../../types';
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

  useEffect(() => {
    const unsub = onMainEvent((msg) => {
      if (msg.type === 'repoStats') {
        setData(msg.data);
        setLoading(false);
      }
    });
    postCommand({ type: 'getRepoStats' });
    return unsub;
  }, []);

  const handleBack = () => setSelectedAuthor(null);

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
            <AuthorDetailView author={selectedAuthor} />
          )}
        </div>

        <div className={s.footer}>
          <button className={s.btnSecondary} onClick={onClose}>{sl.close}</button>
        </div>
      </div>
    </div>
  );
}
