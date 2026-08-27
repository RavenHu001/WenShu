// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IconButton } from '../../src/renderer/components/common/IconButton';
import { MenuSurface, type MenuCommand } from '../../src/renderer/components/common/MenuSurface';
import { ModalDialog } from '../../src/renderer/components/common/ModalDialog';
import { ToastRegion, type ToastMessage } from '../../src/renderer/components/common/ToastRegion';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('IconButton', () => {
  it('uses a project SVG and exposes a concrete accessible name', () => {
    render(<IconButton icon="search" label="搜索工作区" />);
    const button = screen.getByRole('button', { name: '搜索工作区' });
    expect(button.querySelector('svg')).not.toBeNull();
    expect(button.textContent).toBe('');
  });
});

describe('MenuSurface', () => {
  function items(onSelect = vi.fn()): readonly MenuCommand[] {
    return [
      { id: 'open', label: '打开', icon: 'file', onSelect },
      { id: 'disabled', label: '不可用', disabled: true, onSelect: vi.fn() },
      {
        id: 'trash',
        label: '删除到回收站',
        icon: 'trash',
        danger: true,
        separatorBefore: true,
        onSelect,
      },
    ];
  }

  it('focuses the first enabled command and wraps Arrow/Tab navigation over disabled items', async () => {
    const user = userEvent.setup();
    render(<MenuSurface label="文件菜单" items={items()} onClose={vi.fn()} />);
    const open = screen.getByRole('menuitem', { name: '打开' });
    const trash = screen.getByRole('menuitem', { name: '删除到回收站' });
    expect(document.activeElement).toBe(open);
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(trash);
    await user.keyboard('{Tab}');
    expect(document.activeElement).toBe(open);
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(trash);
  });

  it('runs Enter/click commands, Escape closes, and restores the captured focus', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    const view = render(
      <MenuSurface
        label="条目菜单"
        items={items(onSelect)}
        onClose={onClose}
        restoreFocusTo={trigger}
      />,
    );
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    view.rerender(
      <MenuSurface
        label="条目菜单"
        items={items(onSelect)}
        onClose={onClose}
        restoreFocusTo={trigger}
      />,
    );
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
    await Promise.resolve();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('closes on an outside pointer without selecting a command', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<MenuSurface label="条目菜单" items={items(onSelect)} onClose={onClose} />);
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('ModalDialog', () => {
  it('traps Tab, closes with Escape, and restores focus after unmount', async () => {
    const user = userEvent.setup();
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    const onCancel = vi.fn();
    const view = render(
      <ModalDialog title="确认操作" onCancel={onCancel}>
        <button type="button">取消</button>
        <button type="button">确定</button>
      </ModalDialog>,
    );
    const cancel = screen.getByRole('button', { name: '取消' });
    const confirm = screen.getByRole('button', { name: '确定' });
    expect(document.activeElement).toBe(cancel);
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(document.activeElement).toBe(confirm);
    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});

describe('ToastRegion', () => {
  it('announces success non-blockingly and remains explicitly dismissible', async () => {
    const user = userEvent.setup();
    const toast: ToastMessage = { id: 1, message: '已移动文档', tone: 'success' };
    const onDismiss = vi.fn();
    render(<ToastRegion toasts={[toast]} onDismiss={onDismiss} />);
    expect(screen.getByRole('status').textContent).toContain('已移动文档');
    await user.click(screen.getByRole('button', { name: '关闭通知' }));
    expect(onDismiss).toHaveBeenCalledWith(1);
  });

  it('uses alert semantics for persistent errors', () => {
    const toast: ToastMessage = { id: 2, message: '移动失败', tone: 'error', persistent: true };
    render(<ToastRegion toasts={[toast]} onDismiss={vi.fn()} />);
    expect(screen.getByRole('alert').textContent).toContain('移动失败');
  });
});
