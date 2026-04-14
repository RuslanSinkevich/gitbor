import { useState } from 'react';
import s from './LfsDialog.module.css';

interface LfsPattern { pattern: string; }

interface Props {
  patterns: LfsPattern[];
  labels: { patterns: string; noPatterns: string; track: string; untrack: string; trackPlaceholder: string };
  onTrack: (pattern: string) => void;
  onUntrack: (pattern: string) => void;
}

/** Tracked patterns section with add/remove controls. */
export function LfsPatternList({ patterns, labels, onTrack, onUntrack }: Props) {
  const [newPattern, setNewPattern] = useState('');

  const handleTrack = () => {
    if (newPattern.trim()) {
      onTrack(newPattern.trim());
      setNewPattern('');
    }
  };

  return (
    <div className={s.section}>
      <span className={s.sectionTitle}>{labels.patterns}</span>
      {patterns.length === 0 ? (
        <span className={s.noItems}>{labels.noPatterns}</span>
      ) : (
        patterns.map((p) => (
          <div key={p.pattern} className={s.patternRow}>
            <span className={s.patternName}>{p.pattern}</span>
            <button className={s.untrackBtn} onClick={() => onUntrack(p.pattern)}>{labels.untrack}</button>
          </div>
        ))
      )}
      <div className={s.trackRow}>
        <input
          className={s.input}
          value={newPattern}
          onChange={(e) => setNewPattern(e.target.value)}
          placeholder={labels.trackPlaceholder}
          onKeyDown={(e) => e.key === 'Enter' && handleTrack()}
        />
        <button className={s.trackBtn} disabled={!newPattern.trim()} onClick={handleTrack}>{labels.track}</button>
      </div>
    </div>
  );
}
