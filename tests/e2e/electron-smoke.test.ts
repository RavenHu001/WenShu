import { Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from 'docx';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';
import JSZip from 'jszip';
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { defaultSettings, defaultState } from '../../src/shared/app-state';
import { resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

const projectRoot = resolve(import.meta.dirname, '../..');
const executablePath = resolve(projectRoot, 'node_modules/electron/dist/electron.exe');
const isolatedRoot = resolve(projectRoot, '.local-data/test/e2e');

beforeAll(async () => {
  await mkdir(isolatedRoot, { recursive: true });
  for (const [path, command] of [
    [executablePath, 'npx install-electron --no'],
    [resolve(projectRoot, 'out/main/index.js'), 'npm run build'],
  ] as const) {
    try {
      await access(path);
    } catch (cause) {
      throw new Error(`Electron E2E prerequisite unavailable: ${path}. Run: ${command}`, { cause });
    }
  }
});

const temporaryRoots: string[] = [];
const applications: ElectronApplication[] = [];

async function destroyTestApplication(application: ElectronApplication): Promise<void> {
  try {
    await application.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.destroy();
      }
    });
  } catch {
    // 已退出的测试实例无需再次关闭。
  }
  try {
    await application.close();
  } catch {
    // 窗口销毁后主进程可能已自行退出。
  }
}

afterEach(async () => {
  // 测试完成时可能故意保留 dirty 标签；销毁隔离测试窗口可避免再次触发产品关闭确认。
  await Promise.all(applications.splice(0).map(destroyTestApplication));
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
}, 30_000);

async function createWorkspace(): Promise<string> {
  const workspace = await mkdtemp(resolve(isolatedRoot, 'workspace-'));
  temporaryRoots.push(workspace);
  return workspace;
}

async function launchWithWorkspace(
  workspace: string,
  existingProfile?: string,
  manualOpen = true,
): Promise<{
  page: Page;
  pageErrors: string[];
  application: ElectronApplication;
  userData: string;
}> {
  const userData = existingProfile ?? (await mkdtemp(resolve(isolatedRoot, 'profile-')));
  if (!existingProfile) temporaryRoots.push(userData);
  const application = await electron.launch({
    executablePath,
    cwd: projectRoot,
    // 自动化会话无稳定 GPU 合成环境；仅测试进程禁用 GPU，不改变产品配置或 fuses。
    args: ['.', `--user-data-dir=${userData}`, '--disable-gpu'],
    env: Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ),
  });
  applications.push(application);
  const electronStderr: string[] = [];
  application.process().stderr?.on('data', (chunk: Buffer) => electronStderr.push(String(chunk)));

  // 仅替换系统目录选择器的结果；产品侧仍走原有的固定窄 IPC 协议。
  await application.evaluate(async ({ dialog }, selectedDirectory) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [selectedDirectory],
    });
  }, workspace);

  const page = await application.firstWindow();
  page.setDefaultTimeout(10_000);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('crash', () => console.info(`Electron E2E renderer crashed: ${electronStderr.join('')}`));
  // `firstWindow()` 可在 loadFile 导航开始前返回 Electron 的 about:blank 初始文档。
  await page.waitForURL(/^file:/, { timeout: 10_000 });
  await page.locator('.app-shell').waitFor();
  if (manualOpen) {
    // Existing profiles may now restore themselves. Do not replace their restored tabs.
    const state = await page.evaluate(() => window.desktop.appState.get());
    if (
      state.status !== 'ok' ||
      !state.snapshot.state.lastWorkspace ||
      state.snapshot.files.state.error
    ) {
      const openWorkspace =
        state.status === 'ok' && state.snapshot.files.state.error
          ? page.getByRole('button', { name: '打开其他文件夹', exact: true })
          : page.getByRole('button', { name: '打开文件夹' });
      await openWorkspace.waitFor({ state: 'visible', timeout: 10_000 });
      await openWorkspace.click();
    }
  }
  return { page, pageErrors, application, userData };
}

async function openFile(page: Page, name: string): Promise<void> {
  const file = page.getByRole('button', { name });
  await file.waitFor({ state: 'visible', timeout: 10_000 });
  await file.click();
  await page.getByRole('tab', { name }).waitFor({ state: 'visible', timeout: 10_000 });
}

async function createSimpleDocx(): Promise<Buffer> {
  return Packer.toBuffer(
    new Document({ sections: [{ children: [new Paragraph('初始 DOCX 内容')] }] }),
  );
}

async function expectOoxml(path: string): Promise<void> {
  const archive = await JSZip.loadAsync(await readFile(path));
  expect(archive.file('[Content_Types].xml')).not.toBeNull();
  expect(archive.file('word/document.xml')).not.toBeNull();
}

async function closeNormally(application: ElectronApplication): Promise<void> {
  const closed = application.waitForEvent('close');
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close());
  await closed;
}

describe('TASK-013 WP3 real restart and restoration', () => {
  it('reopens protected/degraded DOCX with fresh compatibility and leaves missing roots retryable', async () => {
    const workspace = await createWorkspace();
    const profile = await mkdtemp(resolve(isolatedRoot, 'restore-errors-'));
    temporaryRoots.push(profile);
    const protectedZip = await JSZip.loadAsync(await createSimpleDocx());
    protectedZip.file(
      'word/settings.xml',
      '<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:documentProtection w:edit="readOnly" w:enforcement="1"/></w:settings>',
    );
    const protectedBytes = await protectedZip.generateAsync({ type: 'nodebuffer' });
    const degradedBytes = await Packer.toBuffer(
      new Document({
        sections: [
          {
            children: [
              new Table({
                rows: [
                  new TableRow({
                    children: [new TableCell({ children: [new Paragraph('table cell')] })],
                  }),
                ],
              }),
              new Paragraph('retained body'),
            ],
          },
        ],
      }),
    );
    await writeFile(resolve(workspace, 'protected.docx'), protectedBytes);
    await writeFile(resolve(workspace, 'degraded.docx'), degradedBytes);
    const state = {
      ...defaultState(),
      lastWorkspace: {
        rootPath: workspace,
        tabRelativePaths: ['protected.docx', 'degraded.docx'],
        activeRelativePath: 'degraded.docx',
      },
    };
    await writeFile(resolve(profile, 'state.json'), JSON.stringify(state));
    const first = await launchWithWorkspace(workspace, profile, false);
    await first.page.getByRole('button', { name: '确认继续编辑并保存', exact: true }).click();
    await first.page.getByText('已确认继续编辑', { exact: true }).waitFor();
    await closeNormally(first.application);
    const second = await launchWithWorkspace(workspace, profile, false);
    await second.page.getByRole('button', { name: '确认继续编辑并保存', exact: true }).waitFor();
    await second.page.getByRole('tab', { name: 'protected.docx', exact: true }).click();
    await second.page.getByText('文档为只读状态', { exact: true }).waitFor();
    expect(
      await second.page
        .locator('.docx-editor-host:not([hidden]) .tiptap')
        .getAttribute('contenteditable'),
    ).toBe('false');
    expect(await second.page.locator('.tab.is-dirty').count()).toBe(0);
    expect(await readFile(resolve(workspace, 'protected.docx'))).toEqual(protectedBytes);
    expect(await readFile(resolve(workspace, 'degraded.docx'))).toEqual(degradedBytes);
    await closeNormally(second.application);
    const missing = resolve(workspace, 'missing-root');
    const original = JSON.stringify({
      ...state,
      lastWorkspace: { ...state.lastWorkspace, rootPath: missing },
    });
    await writeFile(resolve(profile, 'state.json'), original);
    const third = await launchWithWorkspace(workspace, profile, false);
    await third.page.getByRole('button', { name: '重试恢复', exact: true }).waitFor();
    expect(
      await third.page.getByRole('button', { name: '打开其他文件夹', exact: true }).isVisible(),
    ).toBe(true);
    expect(await readFile(resolve(profile, 'state.json'), 'utf8')).toBe(original);
    await mkdir(missing);
    await third.page.getByRole('button', { name: '重试恢复', exact: true }).click();
    await third.page.getByText('无法读取文件 degraded.docx', { exact: true }).waitFor();
    expect(await third.page.getByRole('tab').count()).toBe(2);
    expect([...first.pageErrors, ...second.pageErrors, ...third.pageErrors]).toEqual([]);
  }, 30_000);
  it('records committed mixed tabs, discards only unsaved text, reloads current disk bytes and persists three modes', async () => {
    const workspace = await createWorkspace();
    await mkdir(resolve(workspace, 'sub'));
    await writeFile(resolve(workspace, 'same.txt'), 'old disk');
    await writeFile(resolve(workspace, 'sub/same.txt'), 'second path');
    await writeFile(resolve(workspace, 'empty.txt'), '');
    await writeFile(resolve(workspace, 'book.docx'), await createSimpleDocx());
    const first = await launchWithWorkspace(workspace);
    for (const name of ['same.txt', 'book.docx', 'empty.txt']) await openFile(first.page, name);
    await first.page.getByRole('button', { name: 'sub', exact: true }).click();
    await first.page.getByTestId('ft-sub/same.txt').click();
    await first.page.getByRole('tab', { name: 'sub/same.txt', exact: true }).waitFor();
    await first.page.getByRole('tab', { name: 'book.docx', exact: true }).click();
    await first.page.locator('.tiptap').filter({ visible: true }).waitFor();
    await first.page.getByRole('tab', { name: 'same.txt', exact: true }).first().click();
    await first.page.locator('.cm-content').fill('unsaved draft');
    await first.page.locator('.tab.is-dirty').waitFor();
    await first.application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.close(),
    );
    const guard = first.page.getByRole('dialog', { name: '放弃未保存修改', exact: true });
    await guard.getByRole('button', { name: '取消', exact: true }).click();
    expect(await first.page.locator('.cm-content').textContent()).toBe('unsaved draft');
    await first.application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.close(),
    );
    const closed = first.application.waitForEvent('close');
    await guard.getByRole('button', { name: '放弃修改', exact: true }).click();
    await closed;
    const statePath = resolve(first.userData, 'state.json');
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    expect(state.lastWorkspace).toEqual({
      rootPath: workspace,
      tabRelativePaths: ['same.txt', 'book.docx', 'empty.txt', 'sub/same.txt'],
      activeRelativePath: 'same.txt',
    });
    expect(JSON.stringify(state)).not.toContain('unsaved draft');
    await writeFile(resolve(workspace, 'same.txt'), 'external disk update');
    await rm(resolve(workspace, 'empty.txt'));
    const second = await launchWithWorkspace(workspace, first.userData, false);
    await second.page.locator('main:not([inert]) .cm-content').waitFor();
    expect(await second.page.getByRole('tab').allTextContents()).toEqual([
      'same.txt',
      'book.docx',
      'empty.txt',
      'same.txt',
    ]);
    expect(await second.page.locator('.cm-content').textContent()).toBe('external disk update');
    expect(await second.page.locator('.tab.is-dirty').count()).toBe(0);
    await second.page.getByRole('tab', { name: 'empty.txt，发生错误', exact: true }).click();
    await second.page.getByText('无法读取文件 empty.txt', { exact: true }).waitFor();
    await writeFile(resolve(workspace, 'empty.txt'), 'now exists');
    await second.page.getByRole('button', { name: '重试', exact: true }).click();
    await second.page.locator('.cm-content').filter({ hasText: 'now exists' }).waitFor();
    await second.page.keyboard.press('Control+,');
    await second.page.getByLabel('启动方式', { exact: true }).selectOption('workspace');
    await second.page.getByText('设置已保存', { exact: true }).waitFor();
    await second.page.keyboard.press('Escape');
    await closeNormally(second.application);
    expect(JSON.parse(await readFile(statePath, 'utf8')).lastWorkspace.tabRelativePaths).toEqual(
      [],
    );
    const third = await launchWithWorkspace(workspace, first.userData, false);
    await third.page.locator('main:not([inert]) .ws-info-path').waitFor();
    expect(await third.page.getByRole('tab').count()).toBe(0);
    await third.page.keyboard.press('Control+,');
    await third.page.getByLabel('启动方式', { exact: true }).selectOption('blank');
    await third.page.getByText('设置已保存', { exact: true }).waitFor();
    await third.page.keyboard.press('Escape');
    await closeNormally(third.application);
    expect(JSON.parse(await readFile(statePath, 'utf8')).lastWorkspace).toBeNull();
    const fourth = await launchWithWorkspace(workspace, first.userData, false);
    await fourth.page.getByText('尚未打开文件夹', { exact: true }).waitFor();
    expect(await fourth.page.getByRole('tab').count()).toBe(0);
    expect([
      ...first.pageErrors,
      ...second.pageErrors,
      ...third.pageErrors,
      ...fourth.pageErrors,
    ]).toEqual([]);
  }, 30_000);

  it('closing incomplete real DOCX reads keeps full record; stopping keeps only visible/loading tabs', async () => {
    const workspace = await createWorkspace();
    const profile = await mkdtemp(resolve(isolatedRoot, 'restore-batch-'));
    temporaryRoots.push(profile);
    // A real bounded DOCX workload provides an observable read phase without mocking or cancelling reads.
    const bytes = await Packer.toBuffer(
      new Document({
        sections: [
          {
            children: Array.from(
              { length: 1200 },
              (_, i) => new Paragraph(`Synthetic restoration paragraph ${i}`),
            ),
          },
        ],
      }),
    );
    const paths = Array.from({ length: 30 }, (_, i) => `document-${i}.docx`);
    await Promise.all(paths.map((path) => writeFile(resolve(workspace, path), bytes)));
    const original = JSON.stringify({
      ...defaultState(),
      lastWorkspace: {
        rootPath: workspace,
        tabRelativePaths: paths,
        activeRelativePath: paths.at(-1),
      },
    });
    await writeFile(resolve(profile, 'state.json'), original);
    const first = await launchWithWorkspace(workspace, profile, false);
    await first.page.getByRole('button', { name: '停止恢复', exact: true }).waitFor();
    expect(await first.page.locator('main').getAttribute('inert')).toBe('');
    await first.page.keyboard.press('Control+,');
    expect(await first.page.getByRole('dialog').count()).toBe(0);
    expect(await readFile(resolve(profile, 'state.json'), 'utf8')).toBe(original);
    await closeNormally(first.application);
    expect(await readFile(resolve(profile, 'state.json'), 'utf8')).toBe(original);
    const second = await launchWithWorkspace(workspace, profile, false);
    await second.page.getByRole('button', { name: '停止恢复', exact: true }).click();
    await second.page
      .getByText('已停止恢复；保留当前已打开和正在读取的标签。', { exact: true })
      .waitFor();
    const count = await second.page.getByRole('tab').count();
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(paths.length);
    await second.page.locator('.docx-editor-host:not([hidden]) .tiptap').waitFor();
    expect(await second.page.getByRole('tab').count()).toBe(count);
    const evidence = resolve(projectRoot, '.local-data/test/task-013/wp3');
    await mkdir(evidence, { recursive: true });
    await second.application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.setSize(900, 600),
    );
    await second.page.screenshot({
      path: resolve(evidence, 'stopped-900x600.png'),
      mask: [second.page.locator('.ws-info-path')],
    });
    await closeNormally(second.application);
    const partial = JSON.parse(await readFile(resolve(profile, 'state.json'), 'utf8'));
    expect(partial.lastWorkspace.tabRelativePaths).toEqual(paths.slice(0, count));
    expect(partial.lastWorkspace.activeRelativePath).toBe(paths[count - 1]);
    expect([...first.pageErrors, ...second.pageErrors]).toEqual([]);
  }, 30_000);
});

describe('Electron E2E：隔离工作区', () => {
  it('WP2 real settings dialog, theme/font persistence, TXT/DOCX history and visual sizes', async () => {
    const workspace = await createWorkspace();
    await writeFile(resolve(workspace, 'display.txt'), 'TXT display');
    const docx = await Packer.toBuffer(
      new Document({
        sections: [
          {
            children: [
              new Paragraph({
                children: [new TextRun({ text: '初始 DOCX 内容', color: 'B3261E' })],
              }),
            ],
          },
        ],
      }),
    );
    await writeFile(resolve(workspace, 'display.docx'), docx);
    const first = await launchWithWorkspace(workspace);
    const { page, application } = first;
    await openFile(page, 'display.txt');
    const txt = page.locator('.cm-content');
    await txt.press('Control+End');
    await page.keyboard.type(' draft');
    await txt.press('Home');
    await txt.press('Shift+End');
    const selection = await page.evaluate(() => window.getSelection()?.toString());
    await page.keyboard.press('Control+,');
    const dialog = page.getByRole('dialog', { name: '设置', exact: true });
    await dialog.waitFor({ timeout: 3000 });
    expect(await page.getByLabel('TXT 字号', { exact: true }).inputValue()).toBe('13');
    await page.getByLabel('主题', { exact: true }).selectOption('dark', { timeout: 3000 });
    await page.getByLabel('TXT 字体', { exact: true }).selectOption('serif');
    await page.getByLabel('TXT 字号', { exact: true }).selectOption('24');
    await page.getByLabel('启动方式', { exact: true }).selectOption('workspace');
    await page.getByText('设置已保存', { exact: true }).waitFor();
    expect(await txt.textContent()).toBe('TXT display draft');
    expect(await page.locator('html').getAttribute('data-theme')).toBe('dark');
    expect(
      await page.locator('.cm-scroller').evaluate((element) => getComputedStyle(element).fontSize),
    ).toBe('24px');
    const evidence = resolve(projectRoot, '.local-data/test/task-013/wp2');
    await mkdir(evidence, { recursive: true });
    for (const [width, height] of [
      [900, 600],
      [1280, 820],
    ]) {
      await application.evaluate(
        ({ BrowserWindow }, size) =>
          BrowserWindow.getAllWindows()[0]!.setSize(size.width!, size.height!),
        { width, height },
      );
      await page.getByText('关闭设置', { exact: true }).scrollIntoViewIfNeeded();
      const bounds = await dialog.boundingBox();
      const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
      expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: resolve(evidence, `settings-dark-${width}x${height}.png`),
        mask: [page.getByLabel('当前数据目录'), page.locator('.ws-info-path')],
      });
      if (width === 900) {
        await dialog.evaluate((element) => {
          element.scrollTop = 0;
        });
        await page.screenshot({
          path: resolve(evidence, 'settings-dark-900x600-top.png'),
          mask: [page.getByLabel('当前数据目录'), page.locator('.ws-info-path')],
        });
      }
    }
    await page.keyboard.press('Escape');
    expect(await page.locator('.tab.is-dirty').count()).toBe(1);
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(selection);
    await txt.press('Control+z');
    expect(await txt.textContent()).toBe('TXT display');
    await txt.press('Control+y');
    expect(await txt.textContent()).toBe('TXT display draft');
    await page.screenshot({
      path: resolve(evidence, 'txt-dark.png'),
      mask: [page.locator('.ws-info-path')],
    });
    await txt.press('Control+f');
    await page.locator('.cm-search input[name="search"]').fill('TXT', { timeout: 3000 });
    // CodeMirror commits its native search field on change/keyup, not input alone.
    await page.locator('.cm-search input[name="search"]').press('Enter');
    await page.locator('.cm-searchMatch').first().waitFor({ timeout: 3000 });
    await page.screenshot({ path: resolve(evidence, 'txt-dark-find.png') });
    await page.getByRole('button', { name: '文件面板', exact: true }).click();
    await openFile(page, 'display.docx');
    const prose = page.locator('.docx-editor .ProseMirror:visible');
    await prose.press('Control+End');
    await page.keyboard.type(' draft');
    await prose.press('Home');
    await prose.press('Shift+End');
    const beforeHtml = await prose.innerHTML();
    const beforeSelection = await page.evaluate(() => window.getSelection()?.toString());
    const font = await prose.evaluate((element) => getComputedStyle(element).fontSize);
    await page.keyboard.press('Control+,');
    await page.getByLabel('TXT 字体', { exact: true }).selectOption('system');
    await page.getByLabel('TXT 字号', { exact: true }).selectOption('18');
    await page.getByText('设置已保存', { exact: true }).waitFor();
    await page.keyboard.press('Escape');
    expect(await prose.innerHTML()).toBe(beforeHtml);
    expect(await page.locator('.tab.is-dirty').count()).toBe(2);
    expect(
      await prose
        .locator('span')
        .first()
        .evaluate((element) => getComputedStyle(element).color),
    ).toBe('rgb(179, 38, 30)');
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(beforeSelection);
    expect(await prose.evaluate((element) => getComputedStyle(element).fontSize)).toBe(font);
    expect(await prose.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
      'rgb(255, 255, 255)',
    );
    await page.screenshot({
      path: resolve(evidence, 'docx-dark.png'),
      mask: [page.locator('.ws-info-path')],
    });
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.setSize(900, 600),
    );
    await page.screenshot({
      path: resolve(evidence, 'docx-dark-900x600.png'),
      mask: [page.locator('.ws-info-path')],
    });
    await prose.press('Control+z');
    expect(await prose.textContent()).toBe('初始 DOCX 内容');
    await prose.press('Control+y');
    expect(await prose.textContent()).toBe('初始 DOCX 内容 draft');
    await prose.press('Control+f');
    await page.getByRole('textbox', { name: '查找内容', exact: true }).fill('DOCX');
    await page.locator('.wenshu-search-current').waitFor();
    await page.screenshot({ path: resolve(evidence, 'docx-dark-find-900x600.png') });
    await page.getByRole('button', { name: '关闭查找', exact: true }).click();
    await page.emulateMedia({ forcedColors: 'active' });
    await page.keyboard.press('Control+,');
    await page.screenshot({
      path: resolve(evidence, 'settings-high-contrast.png'),
      mask: [page.getByLabel('当前数据目录'), page.locator('.ws-info-path')],
    });
    expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches)).toBe(true);
    await page.keyboard.press('Escape');
    await page.emulateMedia({ forcedColors: 'none' });
    await page.getByRole('button', { name: '视图', exact: true }).click();
    await page.getByRole('menuitem', { name: '设置…', exact: true }).click();
    await page.getByLabel('主题', { exact: true }).selectOption('system');
    await page.getByText('设置已保存', { exact: true }).waitFor();
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForFunction(() => document.documentElement.dataset['theme'] === 'light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForFunction(() => document.documentElement.dataset['theme'] === 'dark');
    await page.getByLabel('主题', { exact: true }).selectOption('dark');
    await page.getByText('设置已保存', { exact: true }).waitFor();
    await page.keyboard.press('Escape');
    expect(
      await page
        .getByRole('button', { name: '视图', exact: true })
        .evaluate((element) => element === document.activeElement),
    ).toBe(true);
    expect(await readFile(resolve(workspace, 'display.txt'), 'utf8')).toBe('TXT display');
    expect(await readFile(resolve(workspace, 'display.docx'))).toEqual(docx);
    await page.keyboard.press('Control+,');
    await page.getByRole('dialog', { name: '设置', exact: true }).waitFor();
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close());
    const closeGuard = page.getByRole('dialog', { name: '放弃未保存修改', exact: true });
    await closeGuard.waitFor();
    expect(await page.getByRole('dialog', { name: '设置', exact: true }).count()).toBe(0);
    await closeGuard.getByRole('button', { name: '取消', exact: true }).click();
    expect(await page.locator('.tab.is-dirty').count()).toBe(2);
    expect(first.pageErrors).toEqual([]);
    await destroyTestApplication(application);
    const second = await launchWithWorkspace(workspace, first.userData);
    expect(await second.page.locator('html').getAttribute('data-theme')).toBe('dark');
    await second.page.keyboard.press('Control+,');
    expect(await second.page.getByLabel('TXT 字体', { exact: true }).inputValue()).toBe('system');
    expect(await second.page.getByLabel('TXT 字号', { exact: true }).inputValue()).toBe('18');
    expect(await second.page.getByLabel('启动方式', { exact: true }).inputValue()).toBe(
      'workspace',
    );
    expect(await second.page.getByRole('tab').count()).toBe(0); // workspace-only mode excludes tabs.
  }, 30_000);

  it('WP2 real write failure keeps preview and old restore record until retry succeeds', async () => {
    const workspace = await createWorkspace();
    const profile = await mkdtemp(resolve(isolatedRoot, 'settings-failure-'));
    temporaryRoots.push(profile);
    const settingsFile = resolve(profile, 'settings.json');
    const stateFile = resolve(profile, 'state.json');
    const state = {
      ...defaultState(),
      lastWorkspace: {
        rootPath: workspace,
        tabRelativePaths: ['sample.txt'],
        activeRelativePath: 'sample.txt',
      },
    };
    await writeFile(settingsFile, JSON.stringify(defaultSettings()));
    await writeFile(stateFile, JSON.stringify(state));
    const { page } = await launchWithWorkspace(workspace, profile);
    await chmod(settingsFile, 0o444);
    try {
      await page.keyboard.press('Control+,');
      await page.getByLabel('主题', { exact: true }).selectOption('dark');
      await page.getByLabel('启动方式', { exact: true }).selectOption('blank');
      await page
        .getByRole('dialog', { name: '设置', exact: true })
        .getByText('重试', { exact: true })
        .waitFor();
      expect(await page.locator('html').getAttribute('data-theme')).toBe('dark');
      expect(JSON.parse(await readFile(settingsFile, 'utf8'))).toEqual(defaultSettings());
      expect(JSON.parse(await readFile(stateFile, 'utf8'))).toEqual(state);
      expect(await page.getByText('此模式尚未保存。当前有效方式：恢复工作区与标签。').count()).toBe(
        1,
      );
      await page.screenshot({
        path: resolve(projectRoot, '.local-data/test/task-013/wp2/settings-write-failure.png'),
        mask: [page.getByLabel('当前数据目录'), page.locator('.ws-info-path')],
      });
    } finally {
      await chmod(settingsFile, 0o666);
    }
    await page
      .getByRole('dialog', { name: '设置', exact: true })
      .getByText('重试', { exact: true })
      .click();
    await page.getByText('设置已保存', { exact: true }).waitFor();
    expect(JSON.parse(await readFile(settingsFile, 'utf8'))).toMatchObject({
      theme: 'dark',
      startupMode: 'blank',
    });
    expect(JSON.parse(await readFile(stateFile, 'utf8')).lastWorkspace).toBeNull();
  }, 30_000);

  it('WP1 real paths, durable preferences, and stale-session rejection through preload', async () => {
    const workspace = await createWorkspace();
    await writeFile(resolve(workspace, 'sample.txt'), 'unchanged body');
    const first = await launchWithWorkspace(workspace);
    const paths = await first.application.evaluate(({ app, session }) => ({
      userData: app.getPath('userData'),
      sessionData: app.getPath('sessionData'),
      storagePath: session.defaultSession.storagePath,
    }));
    expect(paths).toEqual({
      userData: first.userData,
      sessionData: resolve(first.userData, 'session'),
      storagePath: resolve(first.userData, 'session'),
    });
    const result = await first.page.evaluate(async () => {
      const selected = await window.desktop.workspace.open();
      if (selected.status !== 'selected') throw new Error('open failed');
      const checkpoint = {
        workspaceSessionId: selected.workspaceSessionId,
        tabRelativePaths: ['sample.txt'],
        activeRelativePath: 'sample.txt',
        sidebar: { width: 270, collapsed: false },
      };
      const queued = await window.desktop.appState.checkpoint(checkpoint);
      const flushed = await window.desktop.appState.flush();
      const preferences = await window.desktop.appState.updatePreferences({
        theme: 'dark',
        txtFontPreset: 'serif',
        txtFontSizePx: 18,
        startupMode: 'workspace-and-tabs',
      });
      await window.desktop.workspace.open();
      const stale = await window.desktop.appState.checkpoint(checkpoint);
      return { queued, flushed, preferences, stale };
    });
    expect(result).toMatchObject({
      queued: { status: 'queued' },
      flushed: { status: 'saved' },
      preferences: { status: 'saved' },
      stale: { status: 'error', error: { code: 'STALE_SESSION' } },
    });
    await destroyTestApplication(first.application);
    const second = await launchWithWorkspace(workspace, first.userData);
    const loaded = await second.page.evaluate(() => window.desktop.appState.get());
    expect(loaded).toMatchObject({
      status: 'ok',
      snapshot: {
        settings: { theme: 'dark', txtFontPreset: 'serif', txtFontSizePx: 18 },
        state: { lastWorkspace: { rootPath: workspace, tabRelativePaths: ['sample.txt'] } },
      },
    });
    expect(await readFile(resolve(workspace, 'sample.txt'), 'utf8')).toBe('unchanged body');
  }, 30_000);
  it('WP1 product startup and exit flush preserve corrupt and future-version originals', async () => {
    const workspace = await createWorkspace();
    const profile = await mkdtemp(resolve(isolatedRoot, 'bad-profile-'));
    temporaryRoots.push(profile);
    const originalSettings = '{bad';
    const originalState = '{"version":999,"future":"keep"}';
    await writeFile(resolve(profile, 'settings.json'), originalSettings);
    await writeFile(resolve(profile, 'state.json'), originalState);
    const running = await launchWithWorkspace(workspace, profile);
    await running.page.getByRole('button', { name: '设置或恢复记录异常 · 查看' }).click();
    expect(await running.page.getByRole('alert').count()).toBe(2);
    expect(await running.page.getByText('重置 state.json…', { exact: true }).count()).toBe(0);
    expect(await running.page.getByLabel('TXT 字号', { exact: true }).inputValue()).toBe('13');
    await running.page.keyboard.press('Escape');
    expect(await running.page.evaluate(() => window.desktop.appState.get())).toMatchObject({
      status: 'ok',
      snapshot: { files: { settings: { status: 'invalid' }, state: { status: 'unsupported' } } },
    });
    expect(await running.page.evaluate(() => window.desktop.appState.flush())).toMatchObject({
      status: 'error',
    });
    await destroyTestApplication(running.application);
    expect(await readFile(resolve(profile, 'settings.json'), 'utf8')).toBe(originalSettings);
    expect(await readFile(resolve(profile, 'state.json'), 'utf8')).toBe(originalState);
  }, 30_000);
  it('启动、受控打开工作区与 About 版本', async () => {
    const workspace = await createWorkspace();
    await writeFile(resolve(workspace, '示例.txt'), '初始文本\n', 'utf8');
    const { page, pageErrors } = await launchWithWorkspace(workspace);

    await page.getByRole('button', { name: '帮助' }).click();
    await page.getByRole('menuitem', { name: '关于文枢' }).click();
    expect(await page.getByRole('dialog', { name: '关于文枢' }).textContent()).toContain(
      '0.1.0-alpha.1',
    );
    expect(pageErrors).toEqual([]);
  }, 30_000);

  it('TXT 编辑保存会写回精确字节', async () => {
    const workspace = await createWorkspace();
    const textPath = resolve(workspace, '示例.txt');
    const expectedText = 'Electron E2E 保存文本\n第二行\n';
    await writeFile(textPath, '初始文本\n', 'utf8');
    const { page, pageErrors } = await launchWithWorkspace(workspace);

    await openFile(page, '示例.txt');
    const editor = page.locator('.cm-content[contenteditable="true"]');
    await editor.waitFor({ state: 'visible', timeout: 10_000 });
    await editor.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type(expectedText);
    await page.getByRole('button', { name: '保存' }).click();
    const saved = page.getByText('已保存', { exact: true });
    await saved.waitFor({ state: 'visible', timeout: 10_000 });
    expect(await saved.isVisible()).toBe(true);

    expect(await readFile(textPath, 'utf8')).toBe(expectedText);
    expect(pageErrors).toEqual([]);
  }, 30_000);

  it('DOCX 保存生成有效 OOXML，并保留原文件备份', async () => {
    const workspace = await createWorkspace();
    const docxPath = resolve(workspace, '示例.docx');
    const backupPath = resolve(workspace, '示例.docx.wenshu.bak');
    await writeFile(docxPath, await createSimpleDocx());
    const original = await readFile(docxPath);
    const { page, pageErrors } = await launchWithWorkspace(workspace);

    await openFile(page, '示例.docx');
    const editor = page.locator('.docx-editor .ProseMirror[contenteditable="true"]');
    await editor.waitFor({ state: 'visible', timeout: 10_000 });
    await editor.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('DOCX 已由 Electron E2E 保存');
    await page.getByRole('button', { name: '保存' }).click();
    const savedWithBackup = page.getByText('已保存 · 已备份', { exact: true });
    await savedWithBackup.waitFor({ state: 'visible', timeout: 10_000 });
    expect(await savedWithBackup.isVisible()).toBe(true);

    await expectOoxml(docxPath);
    await expectOoxml(backupPath);
    expect(await readFile(backupPath)).toEqual(original);
    expect(pageErrors).toEqual([]);
  }, 30_000);

  it('未保存 TXT 关闭标签时要求确认，取消后保留编辑内容', async () => {
    const workspace = await createWorkspace();
    await writeFile(resolve(workspace, '示例.txt'), '初始文本\n', 'utf8');
    const { page, pageErrors } = await launchWithWorkspace(workspace);

    await openFile(page, '示例.txt');
    const editor = page.locator('.cm-content[contenteditable="true"]');
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.type('未保存修改');
    const dirtyTab = page.getByRole('tab', { name: '示例.txt，未保存' });
    await dirtyTab.waitFor({ state: 'visible', timeout: 10_000 });
    expect(await dirtyTab.isVisible()).toBe(true);

    await page.getByRole('button', { name: '关闭 示例.txt' }).click();
    const dialog = page.getByRole('dialog', { name: '放弃未保存修改' });
    await dialog.waitFor({ state: 'visible', timeout: 10_000 });
    expect(await dialog.isVisible()).toBe(true);
    expect(await dialog.textContent()).toContain('放弃对 示例.txt 的未保存修改并关闭标签？');
    await dialog.getByRole('button', { name: '取消' }).click();

    await dirtyTab.waitFor({ state: 'visible', timeout: 10_000 });
    expect(await dirtyTab.isVisible()).toBe(true);
    expect(await editor.textContent()).toContain('未保存修改');
    expect(pageErrors).toEqual([]);
  }, 30_000);
});
