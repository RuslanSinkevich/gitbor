import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { OperationJournal } from '../../src/core/safety/OperationJournal';

const TEST_GIT_DIR = join(__dirname, '__journal_test__', '.git');

beforeEach(() => {
  if (existsSync(join(__dirname, '__journal_test__')))
    rmSync(join(__dirname, '__journal_test__'), { recursive: true, force: true });
  mkdirSync(TEST_GIT_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(join(__dirname, '__journal_test__'), { recursive: true, force: true });
});

describe('OperationJournal', () => {
  it('starts with empty entries', async () => {
    const j = new OperationJournal(TEST_GIT_DIR);
    const entries = await j.getAll();
    expect(entries).toEqual([]);
  });

  it('records begin + complete cycle', async () => {
    const j = new OperationJournal(TEST_GIT_DIR);
    const id = await j.begin({
      operation: 'testOp',
      savedState: { headHash: 'abc', branchName: 'main', hasUncommitted: false },
      params: { target: 'dev' },
    });

    expect(id).toMatch(/^op_/);

    let entries = await j.getAll();
    expect(entries).toHaveLength(1);
    expect(entries[0].status).toBe('started');

    await j.complete(id);
    entries = await j.getAll();
    expect(entries[0].status).toBe('completed');
    expect(entries[0].completedAt).toBeDefined();
  });

  it('records begin + fail cycle', async () => {
    const j = new OperationJournal(TEST_GIT_DIR);
    const id = await j.begin({
      operation: 'failOp',
      savedState: { headHash: 'def', branchName: 'dev', hasUncommitted: true },
      params: {},
    });

    await j.fail(id, 'something broke');
    const entries = await j.getAll();
    expect(entries[0].status).toBe('failed');
    expect(entries[0].error).toBe('something broke');
  });

  it('getIncomplete returns only started entries', async () => {
    const j = new OperationJournal(TEST_GIT_DIR);

    const id1 = await j.begin({
      operation: 'op1', savedState: { headHash: 'a', branchName: 'main', hasUncommitted: false }, params: {},
    });
    await j.begin({
      operation: 'op2', savedState: { headHash: 'b', branchName: 'main', hasUncommitted: false }, params: {},
    });
    await j.complete(id1);

    const incomplete = await j.getIncomplete();
    expect(incomplete).toHaveLength(1);
    expect(incomplete[0].operation).toBe('op2');
  });

  it('cleanup removes old completed entries', async () => {
    const j = new OperationJournal(TEST_GIT_DIR);
    const id = await j.begin({
      operation: 'oldOp', savedState: { headHash: 'x', branchName: 'main', hasUncommitted: false }, params: {},
    });
    await j.complete(id);

    await j.cleanup(0);
    const entries = await j.getAll();
    expect(entries).toHaveLength(0);
  });

  it('cleanup keeps started entries regardless of age', async () => {
    const j = new OperationJournal(TEST_GIT_DIR);
    await j.begin({
      operation: 'hangingOp', savedState: { headHash: 'y', branchName: 'dev', hasUncommitted: false }, params: {},
    });

    await j.cleanup(0);
    const entries = await j.getAll();
    expect(entries).toHaveLength(1);
    expect(entries[0].status).toBe('started');
  });

  it('handles concurrent operations', async () => {
    const j = new OperationJournal(TEST_GIT_DIR);

    const ids = await Promise.all([
      j.begin({ operation: 'a', savedState: { headHash: '1', branchName: 'm', hasUncommitted: false }, params: {} }),
      j.begin({ operation: 'b', savedState: { headHash: '2', branchName: 'm', hasUncommitted: false }, params: {} }),
      j.begin({ operation: 'c', savedState: { headHash: '3', branchName: 'm', hasUncommitted: false }, params: {} }),
    ]);

    expect(ids).toHaveLength(3);
    const entries = await j.getAll();
    expect(entries).toHaveLength(3);
  });
});
