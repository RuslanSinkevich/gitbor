import { useState, type ReactNode } from 'react';

export interface SgTreeNode {
  id: string;
  label: string;
  icon?: ReactNode;
  children?: SgTreeNode[];
  data?: unknown;
}

interface SgTreeProps {
  nodes: SgTreeNode[];
  onSelect?: (node: SgTreeNode) => void;
  selectedId?: string | null;
}

interface SgTreeItemProps {
  node: SgTreeNode;
  depth: number;
  onSelect?: (node: SgTreeNode) => void;
  selectedId?: string | null;
}

function SgTreeItem({ node, depth, onSelect, selectedId }: SgTreeItemProps) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children && node.children.length > 0;
  const isSelected = node.id === selectedId;

  return (
    <div className="sg-tree-item">
      <div
        className={`sg-tree-row ${isSelected ? 'sg-tree-row--selected' : ''}`}
        style={{ paddingLeft: depth * 16 + 4 }}
        onClick={() => {
          if (hasChildren) setExpanded(e => !e);
          onSelect?.(node);
        }}
      >
        {hasChildren && (
          <span className={`sg-tree-arrow ${expanded ? 'sg-tree-arrow--expanded' : ''}`}>&#9656;</span>
        )}
        {!hasChildren && <span className="sg-tree-arrow-placeholder" />}
        {node.icon && <span className="sg-tree-icon">{node.icon}</span>}
        <span className="sg-tree-label">{node.label}</span>
      </div>
      {hasChildren && expanded && (
        <div className="sg-tree-children">
          {node.children!.map(child => (
            <SgTreeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              onSelect={onSelect}
              selectedId={selectedId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function SgTree({ nodes, onSelect, selectedId }: SgTreeProps) {
  return (
    <div className="sg-tree">
      {nodes.map(node => (
        <SgTreeItem key={node.id} node={node} depth={0} onSelect={onSelect} selectedId={selectedId} />
      ))}
    </div>
  );
}
