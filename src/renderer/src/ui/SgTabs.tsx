import { useState, type ReactNode } from 'react';

interface SgTab {
  id: string;
  label: string;
  content: ReactNode;
  disabled?: boolean;
}

interface SgTabsProps {
  tabs: SgTab[];
  defaultTab?: string;
  onChange?: (tabId: string) => void;
}

export function SgTabs({ tabs, defaultTab, onChange }: SgTabsProps) {
  const [activeId, setActiveId] = useState(defaultTab || tabs[0]?.id);
  const activeTab = tabs.find(t => t.id === activeId);

  const handleClick = (id: string) => {
    setActiveId(id);
    onChange?.(id);
  };

  return (
    <div className="sg-tabs">
      <div className="sg-tabs-header" role="tablist">
        {tabs.map(tab => (
          <button
            key={tab.id}
            role="tab"
            className={`sg-tabs-tab ${tab.id === activeId ? 'sg-tabs-tab--active' : ''}`}
            disabled={tab.disabled}
            onClick={() => handleClick(tab.id)}
            aria-selected={tab.id === activeId}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="sg-tabs-content" role="tabpanel">
        {activeTab?.content}
      </div>
    </div>
  );
}
