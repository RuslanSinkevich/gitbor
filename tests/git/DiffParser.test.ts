import { describe, it, expect } from 'vitest';
import { parseDiff } from '../../src/core/git/DiffParser';

describe('parseDiff', () => {
  it('returns empty for empty input', () => {
    expect(parseDiff('')).toEqual([]);
  });

  it('parses a simple modification diff', () => {
    const raw = `diff --git a/src/app.ts b/src/app.ts
index abc..def 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,3 @@
 line1
-old line
+new line
 line3
`;
    const files = parseDiff(raw);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('src/app.ts');
    expect(files[0].status).toBe('modified');
    expect(files[0].isBinary).toBe(false);
    expect(files[0].hunks).toHaveLength(1);

    const hunk = files[0].hunks[0];
    expect(hunk.oldStart).toBe(1);
    expect(hunk.oldCount).toBe(3);
    expect(hunk.newStart).toBe(1);
    expect(hunk.newCount).toBe(3);
    expect(hunk.lines.length).toBeGreaterThanOrEqual(3);
    expect(hunk.lines[0].type).toBe('context');
    expect(hunk.lines[1].type).toBe('remove');
    expect(hunk.lines[1].content).toBe('old line');
    expect(hunk.lines[2].type).toBe('add');
    expect(hunk.lines[2].content).toBe('new line');
    expect(hunk.lines[3].type).toBe('context');
  });

  it('detects new file', () => {
    const raw = `diff --git a/new.ts b/new.ts
new file mode 100644
--- /dev/null
+++ b/new.ts
@@ -0,0 +1,2 @@
+line1
+line2
`;
    const files = parseDiff(raw);
    expect(files[0].status).toBe('added');
  });

  it('detects deleted file', () => {
    const raw = `diff --git a/old.ts b/old.ts
deleted file mode 100644
--- a/old.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-line1
-line2
`;
    const files = parseDiff(raw);
    expect(files[0].status).toBe('deleted');
  });

  it('detects renamed file', () => {
    const raw = `diff --git a/old.ts b/new.ts
rename from old.ts
rename to new.ts
`;
    const files = parseDiff(raw);
    expect(files[0].status).toBe('renamed');
    expect(files[0].path).toBe('new.ts');
    expect(files[0].oldPath).toBe('old.ts');
  });

  it('detects binary file', () => {
    const raw = `diff --git a/img.png b/img.png
Binary files a/img.png and b/img.png differ
`;
    const files = parseDiff(raw);
    expect(files[0].isBinary).toBe(true);
    expect(files[0].hunks).toHaveLength(0);
  });

  it('parses multiple files', () => {
    const raw = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1 +1 @@
-old
+new
diff --git a/b.ts b/b.ts
--- a/b.ts
+++ b/b.ts
@@ -1 +1 @@
-x
+y
`;
    expect(parseDiff(raw)).toHaveLength(2);
  });

  it('assigns correct line numbers', () => {
    const raw = `diff --git a/f.ts b/f.ts
--- a/f.ts
+++ b/f.ts
@@ -10,3 +20,4 @@
 context
-removed
+added1
+added2
 context2
`;
    const hunk = parseDiff(raw)[0].hunks[0];
    expect(hunk.lines[0]).toMatchObject({ type: 'context', oldLineNo: 10, newLineNo: 20 });
    expect(hunk.lines[1]).toMatchObject({ type: 'remove', oldLineNo: 11, newLineNo: null });
    expect(hunk.lines[2]).toMatchObject({ type: 'add', oldLineNo: null, newLineNo: 21 });
    expect(hunk.lines[3]).toMatchObject({ type: 'add', oldLineNo: null, newLineNo: 22 });
    expect(hunk.lines[4]).toMatchObject({ type: 'context', oldLineNo: 12, newLineNo: 23 });
  });

  it('handles multiple hunks', () => {
    const raw = `diff --git a/f.ts b/f.ts
--- a/f.ts
+++ b/f.ts
@@ -1,2 +1,2 @@
-a
+b
 c
@@ -10,2 +10,2 @@
-x
+y
 z
`;
    const files = parseDiff(raw);
    expect(files[0].hunks).toHaveLength(2);
  });

  it('handles CRLF in input', () => {
    const raw = `diff --git a/f.ts b/f.ts\r\n--- a/f.ts\r\n+++ b/f.ts\r\n@@ -1 +1 @@\r\n-old\r\n+new\r\n`;
    const files = parseDiff(raw);
    expect(files).toHaveLength(1);
    expect(files[0].hunks[0].lines).toHaveLength(2);
  });
});
