import { _electron as electron, type ElectronApplication } from 'playwright-core';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const temporaryRoots: string[] = [];
const applications: ElectronApplication[] = [];

afterEach(async () => {
  await Promise.all(applications.splice(0).map((application) => application.close()));
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('Electron E2E：隔离工作区', () => {
  it('启动、受控打开工作区与 About 版本', async () => {
    const workspace = await mkdtemp(resolve(tmpdir(), 'wenshu-e2e-'));
    temporaryRoots.push(workspace);
    await writeFile(resolve(workspace, '示例.txt'), '初始文本\n', 'utf8');

    const application = await electron.launch({
      executablePath: resolve('node_modules', 'electron', 'dist', 'electron.exe'),
      args: ['.'],
      env: Object.fromEntries(
        Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
      ),
    });
    applications.push(application);

    await application.evaluate(
      async ({ dialog }, selectedDirectory) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [selectedDirectory],
        });
      },
      workspace,
    );

    const page = await application.firstWindow();
    const openWorkspace = page.getByRole('button', { name: '打开文件夹' });
    await openWorkspace.waitFor({ state: 'visible', timeout: 10_000 });
    expect(await openWorkspace.isVisible()).toBe(true);
    await openWorkspace.click();
    const workspaceFile = page.getByText('示例.txt', { exact: true });
    await workspaceFile.waitFor({ state: 'visible', timeout: 10_000 });
    expect(await workspaceFile.isVisible()).toBe(true);

    await page.getByRole('button', { name: '帮助' }).click();
    await page.getByRole('menuitem', { name: '关于文枢' }).click();
    expect(await page.getByRole('dialog', { name: '关于文枢' }).textContent()).toContain(
      '0.1.0-alpha.1',
    );
  }, 30_000);
});
