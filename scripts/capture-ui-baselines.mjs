import console from 'node:console';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { _electron as electron } from 'playwright-core';

// Use the real product main/preload/store. No screenshot-only preference service.
const projectRoot = resolve(import.meta.dirname, '..');
const outputDirectory = resolve(
  projectRoot,
  process.env.WENSHU_CAPTURE_OUTPUT ?? 'docs/visual-baselines/task-011',
);
const isolatedRoot = resolve(projectRoot, '.local-data/screenshots');
const deviceScale = process.env.WENSHU_CAPTURE_DEVICE_SCALE;
const forceHighContrast = process.env.WENSHU_CAPTURE_HIGH_CONTRAST === '1';
const zoomFactor = Number(process.env.WENSHU_CAPTURE_ZOOM_FACTOR ?? '1');
const matrixOnly = process.env.WENSHU_CAPTURE_MATRIX_ONLY === '1';

async function capture(name, width, height, prepare) {
  const profile = await mkdtemp(resolve(isolatedRoot, 'profile-'));
  const application = await electron.launch({
    executablePath: resolve(projectRoot, 'node_modules/electron/dist/electron.exe'),
    cwd: projectRoot,
    args: [
      '.',
      `--user-data-dir=${profile}`,
      '--disable-gpu',
      ...(deviceScale ? [`--force-device-scale-factor=${deviceScale}`] : []),
      ...(forceHighContrast ? ['--force-high-contrast'] : []),
    ],
  });
  try {
    const page = await application.firstWindow();
    await page.waitForURL(/^file:/);
    await page.getByRole('button', { name: '打开文件夹' }).waitFor();
    await application.evaluate(
      ({ BrowserWindow }, options) => {
        const window = BrowserWindow.getAllWindows()[0];
        window.setSize(options.width, options.height);
        window.webContents.setZoomFactor(options.zoom);
      },
      { width, height, zoom: Number.isFinite(zoomFactor) && zoomFactor > 0 ? zoomFactor : 1 },
    );
    if (prepare) await prepare(page);
    await page.evaluate('document.fonts.ready');
    await page.screenshot({ path: resolve(outputDirectory, `${name}.png`) });
  } finally {
    await application.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.destroy();
    });
    await application.close();
  }
}

try {
  await mkdir(isolatedRoot, { recursive: true });
  await mkdir(outputDirectory, { recursive: true });
  const variant = forceHighContrast
    ? 'high-contrast'
    : zoomFactor !== 1
      ? `text-${Math.round(zoomFactor * 100)}`
      : deviceScale
        ? `scale-${Math.round(Number(deviceScale) * 100)}`
        : 'normal';
  if (matrixOnly) await capture(`empty-files-900x600-${variant}`, 900, 600);
  else {
    await capture('empty-files-1280x820', 1280, 820);
    await capture('empty-files-900x600', 900, 600);
    await capture('empty-search-1280x820', 1280, 820, (page) =>
      page.getByRole('button', { name: '搜索面板' }).click(),
    );
    await capture('about-900x600', 900, 600, async (page) => {
      await page.getByRole('button', { name: '帮助', exact: true }).click();
      await page.getByRole('menuitem', { name: '关于文枢' }).click();
    });
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
