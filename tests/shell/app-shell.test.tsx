// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ActivityBar } from '../../src/renderer/components/shell/ActivityBar';
import {
  AppMenuBar,
  type AppMenuActions,
  type AppMenuCapabilities,
} from '../../src/renderer/components/shell/AppMenuBar';
import { AboutDialog } from '../../src/renderer/components/shell/AboutDialog';
import { StatusBar } from '../../src/renderer/components/shell/StatusBar';
import { SidebarResizeHandle } from '../../src/renderer/components/shell/SidebarResizeHandle';

afterEach(cleanup);

function actions(): AppMenuActions {
  return {
    openWorkspace: vi.fn(),
    createText: vi.fn(),
    createDocx: vi.fn(),
    createDirectory: vi.fn(),
    save: vi.fn(),
    saveAs: vi.fn(),
    closeTab: vi.fn(),
    find: vi.fn(),
    replace: vi.fn(),
    workspaceSearch: vi.fn(),
    toggleSidebar: vi.fn(),
    about: vi.fn(),
  };
}

const allEnabled: AppMenuCapabilities = {
  hasWorkspace: true,
  hasActiveTab: true,
  canSave: true,
  canSaveAs: true,
  sidebarCollapsed: false,
};

describe('AppMenuBar', () => {
  it('contains only implemented Chinese menus and routes real file commands', async () => {
    const user = userEvent.setup();
    const handlers = actions();
    render(<AppMenuBar actions={handlers} capabilities={allEnabled} />);
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      '文件',
      '编辑',
      '视图',
      '帮助',
    ]);
    await user.click(screen.getByRole('button', { name: '文件' }));
    await user.click(screen.getByRole('menuitem', { name: '保存' }));
    expect(handlers.save).toHaveBeenCalledTimes(1);
  });

  it('disables workspace/document commands from explicit capabilities', async () => {
    const user = userEvent.setup();
    render(
      <AppMenuBar
        actions={actions()}
        capabilities={{
          ...allEnabled,
          hasWorkspace: false,
          hasActiveTab: false,
          canSave: false,
          canSaveAs: false,
        }}
      />,
    );
    await user.click(screen.getByRole('button', { name: '文件' }));
    expect(
      (screen.getByRole('menuitem', { name: '新建 TXT…' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((screen.getByRole('menuitem', { name: '保存' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole('menuitem', { name: '关闭标签' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('changes top-level focus with left/right and exposes the sidebar label matching state', async () => {
    const user = userEvent.setup();
    const view = render(<AppMenuBar actions={actions()} capabilities={allEnabled} />);
    const file = screen.getByRole('button', { name: '文件' });
    file.focus();
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '编辑' }));
    view.rerender(
      <AppMenuBar actions={actions()} capabilities={{ ...allEnabled, sidebarCollapsed: true }} />,
    );
    await user.click(screen.getByRole('button', { name: '视图' }));
    expect(screen.getByRole('menuitem', { name: '展开侧栏' })).toBeDefined();
  });
});

describe('shell status and activity', () => {
  it('uses SVG activity buttons with accessible names and no fake settings entry', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ActivityBar activity="files" onChange={onChange} />);
    expect(screen.getByRole('button', { name: '文件面板' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.queryByRole('button', { name: /设置/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: '搜索面板' }));
    expect(onChange).toHaveBeenCalledWith('search');
  });

  it('keeps document/workspace context in the low-weight status bar without Electron version', () => {
    render(<StatusBar documentType="DOCX" saveStatus="外部冲突" tone="error" />);
    expect(screen.getByText('外部冲突')).toBeDefined();
    expect(screen.getByText('DOCX')).toBeDefined();
    expect(screen.queryByText(/Electron/)).toBeNull();
  });

  it('moves platform and Electron version into the About dialog', () => {
    render(
      <AboutDialog
        runtime={{ platform: 'win32', electronVersion: '43.4.1', appVersion: '0.1.0-alpha.1' }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole('dialog', { name: '关于文枢' })).toBeDefined();
    expect(screen.getByText('Windows')).toBeDefined();
    expect(screen.getByText('43.4.1')).toBeDefined();
    expect(screen.getAllByText('0.1.0-alpha.1')).toHaveLength(1);
    expect(screen.getByText('Alpha · 版本 0.1.0-alpha.1')).toBeDefined();
  });
});

describe('SidebarResizeHandle', () => {
  it('exposes separator values and supports bounded keyboard resizing', async () => {
    const user = userEvent.setup();
    const onWidthChange = vi.fn();
    render(<SidebarResizeHandle width={258} onWidthChange={onWidthChange} />);
    const handle = screen.getByRole('separator', { name: '调整侧栏宽度' });
    expect(handle.getAttribute('aria-valuemin')).toBe('180');
    expect(handle.getAttribute('aria-valuemax')).toBe('420');
    handle.focus();
    await user.keyboard('{ArrowRight}{Home}{End}');
    expect(onWidthChange.mock.calls.map((call) => call[0])).toEqual([274, 180, 420]);
  });

  it('tracks pointer movement and stops after pointerup/unmount', () => {
    const onWidthChange = vi.fn();
    const view = render(<SidebarResizeHandle width={258} onWidthChange={onWidthChange} />);
    const handle = screen.getByRole('separator', { name: '调整侧栏宽度' });
    fireEvent.pointerDown(handle, { button: 0, clientX: 250 });
    fireEvent.pointerMove(window, { clientX: 300 });
    expect(onWidthChange).toHaveBeenLastCalledWith(308);
    fireEvent.pointerUp(window);
    fireEvent.pointerMove(window, { clientX: 330 });
    expect(onWidthChange).toHaveBeenCalledTimes(1);
    view.unmount();
    fireEvent.pointerMove(window, { clientX: 360 });
    expect(onWidthChange).toHaveBeenCalledTimes(1);
  });
});
