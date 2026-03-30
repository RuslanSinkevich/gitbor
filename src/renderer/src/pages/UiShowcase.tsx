import { useState } from 'react';
import { SgButton } from '../ui';
import { t, setLang, getLang } from '../i18n';
import type { LangCode } from '../i18n';
import {
  ButtonsSection,
  InputsSection,
  SelectCheckboxSection,
  DialogSection,
  TabsSection,
  TreeSection,
  ContextMenuSection,
  SplitPaneSection,
  ProgressSection,
  TooltipSection,
  ToastSection,
  BadgeSection,
  TableSection,
  GraphPreviewSection,
} from './showcase/sections';

const SECTION_COMPONENTS: Record<string, React.FC> = {
  buttons: ButtonsSection,
  inputs: InputsSection,
  selectCheckbox: SelectCheckboxSection,
  dialog: DialogSection,
  tabs: TabsSection,
  tree: TreeSection,
  contextMenu: ContextMenuSection,
  splitPane: SplitPaneSection,
  progress: ProgressSection,
  tooltip: TooltipSection,
  toast: ToastSection,
  badge: BadgeSection,
  table: TableSection,
  graphPreview: GraphPreviewSection,
};

export function UiShowcase() {
  const [, forceUpdate] = useState(0);
  const loc = t();

  const SECTIONS: { id: string; label: string }[] = [
    { id: 'buttons', label: loc.showcase.buttons },
    { id: 'inputs', label: loc.showcase.inputs },
    { id: 'selectCheckbox', label: loc.showcase.selectCheckbox },
    { id: 'dialog', label: loc.showcase.dialog },
    { id: 'tabs', label: loc.showcase.tabs },
    { id: 'tree', label: loc.showcase.tree },
    { id: 'contextMenu', label: loc.showcase.contextMenu },
    { id: 'splitPane', label: loc.showcase.splitPane },
    { id: 'progress', label: loc.showcase.progress },
    { id: 'tooltip', label: loc.showcase.tooltip },
    { id: 'toast', label: loc.showcase.toast },
    { id: 'badge', label: loc.showcase.badge },
    { id: 'table', label: loc.showcase.table },
    { id: 'graphPreview', label: loc.showcase.graphPreview },
  ];

  const [activeSection, setActiveSection] = useState(SECTIONS[0].id);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [lang, setLangState] = useState<LangCode>(getLang());

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
  };

  const toggleLang = () => {
    const next: LangCode = lang === 'ru' ? 'en' : 'ru';
    setLang(next);
    setLangState(next);
    forceUpdate(n => n + 1);
    (window as any).skyForkAPI?.setLang?.(next);
  };

  const activeLabel = SECTIONS.find(s => s.id === activeSection)?.label ?? '';
  const ActiveComponent = SECTION_COMPONENTS[activeSection];

  return (
    <div className="sg-showcase">
      <aside className="sg-showcase-nav">
        <div className="sg-showcase-nav-header">
          <h2>{loc.showcase.title}</h2>
          <div style={{ display: 'flex', gap: 4 }}>
            <SgButton variant="ghost" size="sm" onClick={toggleLang}>{lang.toUpperCase()}</SgButton>
            <SgButton variant="ghost" size="sm" onClick={toggleTheme}>
              {theme === 'dark' ? '☀' : '☾'}
            </SgButton>
          </div>
        </div>
        {SECTIONS.map(s => (
          <div
            key={s.id}
            className={`sg-showcase-nav-item ${s.id === activeSection ? 'sg-showcase-nav-item--active' : ''}`}
            onClick={() => setActiveSection(s.id)}
          >
            {s.label}
          </div>
        ))}
      </aside>
      <main className="sg-showcase-content">
        <h1>{activeLabel}</h1>
        {ActiveComponent && <ActiveComponent />}
      </main>
    </div>
  );
}
