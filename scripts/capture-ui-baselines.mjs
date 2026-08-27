import { app, BrowserWindow, ipcMain } from 'electron';
import console from 'node:console';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve } from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';

const deviceScale = process.env.WENSHU_CAPTURE_DEVICE_SCALE;
const forceHighContrast = process.env.WENSHU_CAPTURE_HIGH_CONTRAST === '1';
const zoomFactor = Number(process.env.WENSHU_CAPTURE_ZOOM_FACTOR ?? '1');
const matrixOnly = process.env.WENSHU_CAPTURE_MATRIX_ONLY === '1';
if (deviceScale) app.commandLine.appendSwitch('force-device-scale-factor', deviceScale);
if (forceHighContrast) app.commandLine.appendSwitch('force-high-contrast');
app.setPath('userData', resolve('out/.capture-user-data'));

const outputDirectory = resolve('docs/visual-baselines/task-011');
const rendererDirectory = resolve('out/renderer');
const preloadEntry = resolve('out/preload/index.js');
let rendererUrl = '';
const captureWindows = [];

ipcMain.handle('window:dirty-changed', () => undefined);

async function settle(window) {
  await window.webContents.executeJavaScript('document.fonts?.ready ?? Promise.resolve()', true);
  await new Promise((resolveDelay) => globalThis.setTimeout(resolveDelay, 180));
}

async function capture(name, width, height, prepare) {
  const window = new BrowserWindow({
    width,
    height,
    show: false,
    backgroundColor: '#f5f6f8',
    webPreferences: {
      preload: preloadEntry,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  captureWindows.push(window);
  await window.loadURL(rendererUrl);
  window.webContents.setZoomFactor(Number.isFinite(zoomFactor) && zoomFactor > 0 ? zoomFactor : 1);
  if (prepare) await prepare(window);
  await settle(window);
  const image = await window.webContents.capturePage();
  await writeFile(resolve(outputDirectory, `${name}.png`), image.toPNG());
  window.hide();
}

void app
  .whenReady()
  .then(async () => {
    await mkdir(outputDirectory, { recursive: true });
    const server = createServer((request, response) => {
      const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname);
      const relativePath = pathname === '/' ? 'index.html' : pathname.slice(1);
      const candidate = resolve(rendererDirectory, relativePath);
      if (!candidate.startsWith(rendererDirectory)) {
        response.writeHead(403).end();
        return;
      }
      void readFile(candidate)
        .then((content) => {
          const mime =
            extname(candidate) === '.html'
              ? 'text/html; charset=utf-8'
              : extname(candidate) === '.css'
                ? 'text/css; charset=utf-8'
                : 'text/javascript; charset=utf-8';
          response.writeHead(200, { 'Content-Type': mime });
          response.end(content);
        })
        .catch(() => response.writeHead(404).end());
    });
    await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('capture server failed');
    rendererUrl = `http://127.0.0.1:${address.port}/index.html`;
    const variant = forceHighContrast
      ? 'high-contrast'
      : zoomFactor !== 1
        ? `text-${Math.round(zoomFactor * 100)}`
        : deviceScale
          ? `scale-${Math.round(Number(deviceScale) * 100)}`
          : 'normal';
    if (matrixOnly) {
      await capture(`empty-files-900x600-${variant}`, 900, 600);
    } else {
      await capture('empty-files-1280x820', 1280, 820);
      await capture('empty-files-900x600', 900, 600);
      await capture('empty-search-1280x820', 1280, 820, async (window) => {
        await window.webContents.executeJavaScript(
          `document.querySelector('button[aria-label="搜索面板"]')?.click()`,
        );
      });
      await capture('about-900x600', 900, 600, async (window) => {
        await window.webContents.executeJavaScript(
          `[...document.querySelectorAll('button')].find((button) => button.textContent === '帮助')?.click()`,
        );
        await window.webContents.executeJavaScript(
          `new Promise((resolve) => requestAnimationFrame(() => resolve(true)))`,
        );
        await window.webContents.executeJavaScript(
          `[...document.querySelectorAll('[role="menuitem"]')].find((button) => button.textContent?.includes('关于文枢'))?.click()`,
        );
      });
    }
    await new Promise((resolveClose) => server.close(resolveClose));
    app.quit();
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
