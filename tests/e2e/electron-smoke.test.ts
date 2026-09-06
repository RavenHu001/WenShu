import { Document, Packer, Paragraph } from 'docx';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';
import JSZip from 'jszip';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

const projectRoot = resolve(import.meta.dirname, '../..');
const executablePath = resolve(projectRoot, 'node_modules/electron/dist/electron.exe');

beforeAll(async () => {
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
  const workspace = await mkdtemp(resolve(tmpdir(), 'wenshu-e2e-'));
  temporaryRoots.push(workspace);
  return workspace;
}

async function launchWithWorkspace(
  workspace: string,
): Promise<{ page: Page; pageErrors: string[] }> {
  const userData = await mkdtemp(resolve(tmpdir(), 'wenshu-e2e-user-data-'));
  temporaryRoots.push(userData);
  const application = await electron.launch({
    executablePath,
    cwd: projectRoot,
    // 自动化会话无稳定 GPU 合成环境；仅测试进程禁用 GPU，不改变产品配置或 fuses。
    args: ['.', `--user-data-dir=${userData}`, '--disable-gpu', '--no-sandbox'],
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
  return { page, pageErrors };
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
