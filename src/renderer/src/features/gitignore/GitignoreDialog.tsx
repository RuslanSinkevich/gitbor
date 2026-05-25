import { useEffect, useMemo, useState } from 'react';
import { t } from '../../i18n';
import { postCommand, onMainEvent } from '../../api';
import { SgDialog } from '../../ui/SgDialog';
import { SgCheckbox } from '../../ui/SgCheckbox';
import {
  TEMPLATE_GROUPS,
  buildContent,
  defaultOsTemplate,
  type GitignoreCategory,
} from './templates';
import s from './GitignoreDialog.module.css';

interface Props {
  onClose: () => void;
}

interface LoadedState {
  existing: string;
  exists: boolean;
}

const CATEGORY_LABEL_KEY: Record<GitignoreCategory, 'os' | 'ide' | 'language'> = {
  os: 'os',
  ide: 'ide',
  language: 'language',
};

/**
 * Add .gitignore Template — двух-колоночная модалка по образцу Fork.
 * Слева категории (OS / IDE / Language) с чекбоксами, справа live preview.
 * Если файл уже есть — merge новых правил, не replace.
 */
export function GitignoreDialog({ onClose }: Props) {
  const loc = t();
  const [loaded, setLoaded] = useState<LoadedState | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => {
    const def = defaultOsTemplate();
    return def ? new Set([def]) : new Set();
  });

  useEffect(() => {
    const off = onMainEvent((msg) => {
      if (msg.type === 'gitignoreContent') {
        setLoaded({ existing: msg.data, exists: msg.exists });
      }
    });
    postCommand({ type: 'getGitignore' });
    return off;
  }, []);

  const orderedSelected = useMemo(() => {
    const order: string[] = [];
    for (const group of TEMPLATE_GROUPS) {
      for (const tpl of group.templates) {
        if (selected.has(tpl.name)) order.push(tpl.name);
      }
    }
    return order;
  }, [selected]);

  const preview = useMemo(
    () => buildContent(orderedSelected, loaded?.existing ?? ''),
    [orderedSelected, loaded],
  );

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleAdd = () => {
    postCommand({ type: 'writeGitignore', content: preview });
    onClose();
  };

  const canAdd = orderedSelected.length > 0 && loaded !== null;

  if (loaded === null) return null;

  return (
    <SgDialog
      open
      title={loc.gitignore.title}
      onClose={onClose}
      size="lg"
      onConfirm={canAdd ? handleAdd : undefined}
      confirmLabel={loaded.exists ? loc.gitignore.merge : loc.gitignore.add}
      cancelLabel={loc.gitignore.cancel}
      confirmDisabled={!canAdd}
    >
      <div className={s.subtitle}>
        {loaded.exists ? loc.gitignore.subtitleMerge : loc.gitignore.subtitleAdd}
      </div>

      <div className={s.layout}>
        <div className={s.categories}>
          {TEMPLATE_GROUPS.map((group) => (
            <div key={group.category} className={s.group}>
              <div className={s.groupTitle}>
                {loc.gitignore.categoryLabels[CATEGORY_LABEL_KEY[group.category]]}
              </div>
              <div className={s.groupItems}>
                {group.templates.map((tpl) => (
                  <SgCheckbox
                    key={tpl.name}
                    label={tpl.name}
                    checked={selected.has(tpl.name)}
                    onChange={() => toggle(tpl.name)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className={s.previewWrap}>
          <div className={s.previewLabel}>{loc.gitignore.previewLabel}</div>
          <pre className={s.preview} aria-readonly="true">
            {orderedSelected.length === 0 ? loc.gitignore.previewEmpty : preview}
          </pre>
        </div>
      </div>
    </SgDialog>
  );
}
