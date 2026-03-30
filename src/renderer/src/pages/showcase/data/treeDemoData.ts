import type { SgTreeNode } from '../../../ui/SgTree';

export const DEMO_TREE: SgTreeNode[] = [
  {
    id: 'branches', label: 'Branches', children: [
      { id: 'main', label: 'main' },
      { id: 'develop', label: 'develop' },
      {
        id: 'feature', label: 'feature', children: [
          { id: 'feature/auth', label: 'feature/auth' },
          { id: 'feature/ui', label: 'feature/ui-kit' },
        ],
      },
    ],
  },
  {
    id: 'tags', label: 'Tags', children: [
      { id: 'v0.1.0', label: 'v0.1.0' },
      { id: 'v0.2.0', label: 'v0.2.0' },
    ],
  },
];
