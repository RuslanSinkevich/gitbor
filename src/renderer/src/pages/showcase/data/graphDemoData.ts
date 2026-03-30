import { computeGraphLayout } from '@core/git/GraphLayout';
import type { Commit, GraphNode, MergeLink } from '../../../types';

function h(id: number): string { return id.toString(16).padStart(4, '0'); }

function cm(hash: string, parents: string[], author: string, date: number, subject: string, refs: Commit['refs'] = []): Commit {
  return { hash, parents, authorName: author, authorEmail: `${author.toLowerCase()}@dev`, authorDate: date, refs, subject };
}

function buildDemoGraph(): { commits: Commit[]; graphNodes: GraphNode[]; maxColumns: number; mergeLinks: MergeLink[] } {
  const T = Math.floor(Date.now() / 1000);
  const d = (n: number) => T - n * 120;

  const commits: Commit[] = [
    cm(h(1), [h(2), h(3)], 'Alice', d(0), 'Merge feature/payments into main', [{ name: 'main', type: 'branch' }, { name: 'HEAD', type: 'head' }]),
    cm(h(2), [h(5)], 'Alice', d(1), 'Update CHANGELOG for v2.0'),
    cm(h(3), [h(4)], 'Frank', d(2), 'Add Stripe webhook handler', [{ name: 'feature/payments', type: 'branch' }]),
    cm(h(4), [h(6)], 'Frank', d(3), 'Implement payment processing service'),
    cm(h(5), [h(7), h(8)], 'Alice', d(4), 'Merge feature/dashboard into main'),
    cm(h(6), [h(9)], 'Frank', d(5), 'Add payment model and migrations'),
    cm(h(7), [h(10)], 'Alice', d(6), 'Fix flaky test in CI'),
    cm(h(8), [h(11)], 'Diana', d(7), 'Add chart tooltips and animations', [{ name: 'feature/dashboard', type: 'branch' }]),
    cm(h(9), [h(12)], 'Frank', d(8), 'Setup Stripe SDK integration'),
    cm(h(10), [h(13), h(14)], 'Alice', d(9), 'Merge hotfix/security into main'),
    cm(h(11), [h(15)], 'Diana', d(10), 'Implement dashboard widgets'),
    cm(h(12), [h(16)], 'Frank', d(11), 'Create payment routes'),
    cm(h(13), [h(16)], 'Alice', d(12), 'Bump dependencies to latest'),
    cm(h(14), [h(16)], 'Charlie', d(13), 'Patch XSS vulnerability in forms', [{ name: 'hotfix/security', type: 'branch' }]),
    cm(h(15), [h(17)], 'Diana', d(14), 'Add dashboard layout and sidebar'),
    cm(h(16), [h(18)], 'Alice', d(15), 'Refactor middleware chain', [{ name: 'origin/main', type: 'remote' }]),
    cm(h(17), [h(18)], 'Diana', d(16), 'Setup chart.js and data fetching'),
    cm(h(18), [h(19), h(20)], 'Alice', d(17), 'Merge feature/notifications into main'),
    cm(h(19), [h(23)], 'Alice', d(18), 'Update README with API docs'),
    cm(h(20), [h(21)], 'Bob', d(19), 'Add push notification support', [{ name: 'feature/notifications', type: 'branch' }]),
    cm(h(21), [h(22)], 'Bob', d(20), 'Implement email notification service'),
    cm(h(22), [h(23)], 'Bob', d(21), 'Create notification preferences UI'),
    cm(h(23), [h(24), h(25)], 'Alice', d(22), 'Merge feature/search into main', [{ name: 'v1.5.0', type: 'tag' }]),
    cm(h(24), [h(28)], 'Alice', d(23), 'Fix pagination bug in user list'),
    cm(h(25), [h(26)], 'Eve', d(24), 'Add fuzzy search with Fuse.js', [{ name: 'feature/search', type: 'branch' }]),
    cm(h(26), [h(27)], 'Eve', d(25), 'Implement search results page'),
    cm(h(27), [h(28)], 'Eve', d(26), 'Add search index builder'),
    cm(h(28), [h(29)], 'Alice', d(27), 'Optimize database queries'),
    cm(h(29), [h(30), h(31)], 'Alice', d(28), 'Merge feature/auth-v2 into main'),
    cm(h(30), [h(34)], 'Alice', d(29), 'Add rate limiting middleware'),
    cm(h(31), [h(32)], 'Bob', d(30), 'Add OAuth2 Google provider', [{ name: 'feature/auth-v2', type: 'branch' }]),
    cm(h(32), [h(33)], 'Bob', d(31), 'Implement refresh token rotation'),
    cm(h(33), [h(34)], 'Bob', d(32), 'Add 2FA TOTP support'),
    cm(h(34), [h(35), h(36)], 'Alice', d(33), 'Merge feature/i18n into main'),
    cm(h(35), [h(39)], 'Alice', d(34), 'Fix memory leak in WebSocket handler'),
    cm(h(36), [h(37)], 'Charlie', d(35), 'Add French and German translations', [{ name: 'feature/i18n', type: 'branch' }]),
    cm(h(37), [h(38)], 'Charlie', d(36), 'Implement language switcher component'),
    cm(h(38), [h(39)], 'Charlie', d(37), 'Setup i18next with namespace loading'),
    cm(h(39), [h(40)], 'Alice', d(38), 'Refactor config to use env validation', [{ name: 'v1.0.0', type: 'tag' }]),
    cm(h(40), [h(41), h(42)], 'Alice', d(39), 'Merge feature/file-upload into main'),
    cm(h(41), [h(45)], 'Alice', d(40), 'Add health check endpoint'),
    cm(h(42), [h(43)], 'Diana', d(41), 'Add image resize on upload', [{ name: 'feature/file-upload', type: 'branch' }]),
    cm(h(43), [h(44)], 'Diana', d(42), 'Implement S3 upload service'),
    cm(h(44), [h(45)], 'Diana', d(43), 'Add file validation and virus scan'),
    cm(h(45), [h(46)], 'Alice', d(44), 'Setup Docker Compose for dev'),
    cm(h(46), [h(47), h(48)], 'Alice', d(45), 'Merge feature/caching into main'),
    cm(h(47), [h(51)], 'Alice', d(46), 'Add request logging with correlation IDs'),
    cm(h(48), [h(49)], 'Eve', d(47), 'Add cache invalidation on write', [{ name: 'feature/caching', type: 'branch' }]),
    cm(h(49), [h(50)], 'Eve', d(48), 'Implement Redis cache layer'),
    cm(h(50), [h(51)], 'Eve', d(49), 'Setup Redis connection pool'),
    cm(h(51), [h(52)], 'Alice', d(50), 'Configure ESLint and Prettier'),
    cm(h(52), [h(53), h(54)], 'Alice', d(51), 'Merge feature/testing into main'),
    cm(h(53), [h(57)], 'Alice', d(52), 'Add TypeScript strict mode'),
    cm(h(54), [h(55)], 'Bob', d(53), 'Add E2E tests with Playwright', [{ name: 'feature/testing', type: 'branch' }]),
    cm(h(55), [h(56)], 'Bob', d(54), 'Setup test fixtures and factories'),
    cm(h(56), [h(57)], 'Bob', d(55), 'Configure Jest with coverage thresholds'),
    cm(h(57), [h(58)], 'Alice', d(56), 'Setup monorepo with Turborepo'),
    cm(h(58), [h(59)], 'Alice', d(57), 'Add Husky pre-commit hooks'),
    cm(h(59), [h(60)], 'Alice', d(58), 'Configure GitHub Actions CI'),
    cm(h(60), [h(61)], 'Alice', d(59), 'Setup Vite and React'),
    cm(h(61), [h(62)], 'Alice', d(60), 'Initialize Node.js project', [{ name: 'v0.1.0', type: 'tag' }]),
    cm(h(62), [], 'Alice', d(61), 'Initial commit'),
  ];

  const layout = computeGraphLayout(commits as any);

  return {
    commits,
    graphNodes: layout.nodes.map(n => ({
      commitIndex: n.commitIndex,
      column: n.column,
      color: n.color,
      connections: n.connections.map(cn => ({ fromCol: cn.fromCol, toCol: cn.toCol, color: cn.color })),
    })),
    maxColumns: layout.maxColumns,
    mergeLinks: layout.mergeLinks.map(ml => ({ ...ml })),
  };
}

export const DEMO_GRAPH = buildDemoGraph();
