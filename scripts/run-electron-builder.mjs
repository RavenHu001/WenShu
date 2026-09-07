/* global process */

import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = resolve(scriptDirectory, '..');
const cacheDirectory = resolve(projectDirectory, '.tools', 'electron-builder-cache');
const cliPath = resolve(projectDirectory, 'node_modules', 'electron-builder', 'cli.js');

await mkdir(cacheDirectory, { recursive: true });

const child = spawn(process.execPath, [cliPath, ...process.argv.slice(2)], {
  cwd: projectDirectory,
  env: { ...process.env, ELECTRON_BUILDER_CACHE: cacheDirectory },
  stdio: 'inherit',
});

child.once('error', (error) => {
  throw error;
});
child.once('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  }
  process.exitCode = code ?? 1;
});
