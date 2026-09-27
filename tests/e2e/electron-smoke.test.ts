import { Document, Packer, Paragraph, TextRun } from 'docx';
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
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('crash', () => console.info(`Electron E2E renderer crashed: ${electronStderr.join('')}`));
  // `firstWindow()` 可在 loadFile 导航开始前返回 Electron 的 about:blank 初始文档。
  await page.waitForURL(/^file:/, { timeout: 10_000 });
  const openWorkspace = page.getByRole('button', { name: '打开文件夹' });
  await openWorkspace.waitFor({ state: 'visible', timeout: 10_000 });
  await openWorkspace.click();
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
    expect(await second.page.getByRole('tab').count()).toBe(0); // WP3 has not been implemented.
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
      await page.getByText('重试', { exact: true }).waitFor();
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
    await page.getByText('重试', { exact: true }).click();
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
