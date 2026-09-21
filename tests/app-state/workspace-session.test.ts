import { describe, expect, it } from 'vitest';
import {
  beginWorkspaceOpen,
  getWorkspaceIdentity,
  isCurrentWorkspaceOpen,
  setCurrentWorkspaceRoot,
} from '../../src/main/workspace/workspace-session';

describe('main-process workspace identity', () => {
  it('issues a new opaque identity even when reopening the same root', () => {
    const first = setCurrentWorkspaceRoot('C:\\synthetic-workspace');
    const second = setCurrentWorkspaceRoot('C:\\synthetic-workspace');
    expect(first.id).not.toBe(second.id);
    expect(getWorkspaceIdentity()).toEqual(second);
    expect(Object.isFrozen(second)).toBe(true);
  });
  it('a newer manual open invalidates any older asynchronous open generation', () => {
    const older = beginWorkspaceOpen();
    const current = beginWorkspaceOpen();
    expect(isCurrentWorkspaceOpen(older)).toBe(false);
    expect(isCurrentWorkspaceOpen(current)).toBe(true);
  });
});
