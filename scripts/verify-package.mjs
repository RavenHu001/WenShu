/* global console, process */

import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractFile, listPackage } from '@electron/asar';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = resolve(scriptDirectory, '..');
const releaseDirectory = resolve(projectDirectory, 'release');
const unpackedDirectory = resolve(releaseDirectory, 'win-unpacked');
const resourcesDirectory = resolve(unpackedDirectory, 'resources');
const appAsarPath = resolve(resourcesDirectory, 'app.asar');
const appAsarUnpackedDirectory = resolve(resourcesDirectory, 'app.asar.unpacked');
const expectedExternalDependencies = ['docx', 'jszip', 'mammoth'];
const unexpectedRendererPackages = ['@codemirror', '@tiptap', 'prosemirror-', 'react', 'react-dom'];
const forbiddenPathPatterns = [
  /^(?:\.git|\.github|\.tools|docs|scripts|src|tests)(?:\/|$)/i,
  /^out\/\.capture-user-data(?:\/|$)/i,
  /(?:^|\/)\.env(?:\..*)?$/i,
  /(?:^|\/)[^/]*\.(?:log|tsbuildinfo)$/i,
  /(?:^|\/)(?:fixtures?|visual-baselines)(?:\/|$)/i,
  /(?:^|\/)(?:userData|userdata)(?:\/|$)/i,
  /(?:^|\/)(?:credentials?|passwords?|secrets?|private[-_]?key)(?:\.[^/]*)?$/i,
  /(?:^|\/)(?:access[-_]?token|api[-_]?key)(?:\.[^/]*)?$/i,
];

const fail = (message) => {
  throw new Error(`package audit failed: ${message}`);
};

const assert = (condition, message) => {
  if (!condition) {
    fail(message);
  }
};

const normalizeAsarPath = (path) => path.replaceAll('\\', '/').replace(/^\/+/, '');

const extractAsarFile = (path) => extractFile(appAsarPath, path.split('/').join('\\'));

const sizeOf = async (path) => (await stat(path)).size;

const directorySize = async (path) => {
  let total = 0;
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const entryPath = resolve(path, entry.name);
    total += entry.isDirectory() ? await directorySize(entryPath) : await sizeOf(entryPath);
  }
  return total;
};

const directoryFileList = async (path) => {
  const files = [];
  const visit = async (current) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const entryPath = resolve(current, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else {
        files.push(relative(path, entryPath).split(sep).join('/'));
      }
    }
  };
  await visit(path);
  return files.sort();
};

const packageNameAt = (path) => {
  const segments = normalizeAsarPath(path).split('/');
  const nodeModulesIndex = segments.lastIndexOf('node_modules');
  if (nodeModulesIndex < 0 || nodeModulesIndex === segments.length - 1) {
    return null;
  }
  const first = segments[nodeModulesIndex + 1];
  return first.startsWith('@') ? `${first}/${segments[nodeModulesIndex + 2] ?? ''}` : first;
};

const peMachine = async (path) => {
  const executable = await readFile(path);
  assert(executable.subarray(0, 2).toString('ascii') === 'MZ', `${path} is not an executable`);
  const peOffset = executable.readUInt32LE(0x3c);
  assert(
    executable.subarray(peOffset, peOffset + 4).toString('ascii') === 'PE\0\0',
    `${path} has no PE header`,
  );
  return executable.readUInt16LE(peOffset + 4);
};

const mode =
  process.argv.find((argument) => argument.startsWith('--mode='))?.slice('--mode='.length) ?? 'win';
assert(mode === 'dir' || mode === 'win', 'mode must be dir or win');

const relativeUnpacked = relative(projectDirectory, unpackedDirectory);
assert(
  relativeUnpacked &&
    !relativeUnpacked.startsWith('..') &&
    !relativeUnpacked.includes(':') &&
    releaseDirectory !== projectDirectory,
  'release path escaped project directory',
);

await stat(appAsarPath);
const asarFiles = (await listPackage(appAsarPath)).map(normalizeAsarPath).sort();
const packageJsonBuffer = extractAsarFile('package.json');
const thirdPartyNoticesBuffer = extractAsarFile('THIRD_PARTY_NOTICES.txt');
const packagedManifest = JSON.parse(packageJsonBuffer.toString('utf8'));
const packagedMain = extractAsarFile('out/main/index.js').toString('utf8');
const externalImports = [...packagedMain.matchAll(/\bfrom\s+["']([^"']+)["']/g)]
  .map((match) => match[1])
  .filter(
    (specifier) =>
      specifier !== 'electron' && !specifier.startsWith('node:') && !specifier.startsWith('.'),
  )
  .sort();
const packagedNodeModules = [
  ...new Set(
    asarFiles
      .filter((path) => path.endsWith('/package.json'))
      .map(packageNameAt)
      .filter(Boolean),
  ),
].sort();
const forbiddenPaths = asarFiles.filter((path) =>
  forbiddenPathPatterns.some((pattern) => pattern.test(path)),
);
const rendererDuplicates = packagedNodeModules.filter((packageName) =>
  unexpectedRendererPackages.some(
    (unexpected) => packageName === unexpected || packageName.startsWith(`${unexpected}/`),
  ),
);

assert(
  packagedManifest.main === './out/main/index.js',
  'packaged package.json main is not ./out/main/index.js',
);
assert(
  packagedManifest.version === '0.1.0-alpha.1',
  'packaged package.json version differs from Alpha version',
);
assert(packagedManifest.productName === '文枢', 'packaged package.json productName differs');
assert(
  thirdPartyNoticesBuffer.toString('utf8').startsWith('WenShu THIRD-PARTY SOFTWARE NOTICES'),
  'packaged THIRD_PARTY_NOTICES.txt is missing or malformed',
);
assert(
  JSON.stringify(Object.keys(packagedManifest.dependencies ?? {}).sort()) ===
    JSON.stringify(expectedExternalDependencies),
  'packaged production dependencies differ from the audited main-process allowlist',
);
assert(
  JSON.stringify(externalImports) === JSON.stringify(expectedExternalDependencies),
  'main external imports differ from allowlist',
);
for (const dependency of expectedExternalDependencies) {
  assert(
    asarFiles.includes(`node_modules/${dependency}/package.json`),
    `missing packaged dependency ${dependency}`,
  );
}
assert(forbiddenPaths.length === 0, `forbidden packaged paths: ${forbiddenPaths.join(', ')}`);
assert(
  rendererDuplicates.length === 0,
  `renderer dependencies repeated in app.asar: ${rendererDuplicates.join(', ')}`,
);

const executablePath = resolve(unpackedDirectory, 'WenShu.exe');
await stat(resolve(unpackedDirectory, 'LICENSE.electron.txt'));
await stat(resolve(unpackedDirectory, 'LICENSES.chromium.html'));
const unpackedStat = await stat(unpackedDirectory);
assert(unpackedStat.isDirectory(), 'win-unpacked directory is missing');
const executableMachine = await peMachine(executablePath);
assert(
  executableMachine === 0x8664,
  `WenShu.exe machine is 0x${executableMachine.toString(16)}, expected x64`,
);

let appAsarUnpackedSize = 0;
let appAsarUnpackedFiles = [];
try {
  const unpackedStat = await stat(appAsarUnpackedDirectory);
  if (unpackedStat.isDirectory()) {
    appAsarUnpackedSize = await directorySize(appAsarUnpackedDirectory);
    appAsarUnpackedFiles = await directoryFileList(appAsarUnpackedDirectory);
  }
} catch (error) {
  if (error?.code !== 'ENOENT') {
    throw error;
  }
}

const artifactPaths = {
  portable: resolve(releaseDirectory, 'WenShu-0.1.0-alpha.1-portable-x64.exe'),
  nsis: resolve(releaseDirectory, 'WenShu-0.1.0-alpha.1-setup-x64.exe'),
};
const artifacts = {};
for (const [name, path] of Object.entries(artifactPaths)) {
  try {
    artifacts[name] = {
      path: relative(projectDirectory, path).split(sep).join('/'),
      size: await sizeOf(path),
    };
  } catch (error) {
    if (mode === 'win' || error?.code !== 'ENOENT') {
      throw error;
    }
  }
}

const report = {
  mode,
  architecture: 'x64',
  executableMachine: `0x${executableMachine.toString(16)}`,
  sizes: {
    unpacked: await directorySize(unpackedDirectory),
    appAsar: await sizeOf(appAsarPath),
    appAsarUnpacked: appAsarUnpackedSize,
  },
  artifacts,
  appAsar: {
    files: asarFiles,
    nodeModules: packagedNodeModules,
    externalImports,
    appAsarUnpackedFiles,
    asarIndexedAndUnpackedNodeModules: [
      ...new Set(
        appAsarUnpackedFiles
          .filter((path) => path.endsWith('/package.json'))
          .map(packageNameAt)
          .filter((packageName) => packagedNodeModules.includes(packageName)),
      ),
    ].sort(),
  },
};

const reportPath = resolve(releaseDirectory, 'package-audit.json');
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  JSON.stringify(
    {
      mode: report.mode,
      architecture: report.architecture,
      executableMachine: report.executableMachine,
      sizes: report.sizes,
      artifacts: report.artifacts,
      externalImports: report.appAsar.externalImports,
      nodeModules: report.appAsar.nodeModules,
      asarIndexedAndUnpackedNodeModules: report.appAsar.asarIndexedAndUnpackedNodeModules,
      report: relative(projectDirectory, reportPath).split(sep).join('/'),
    },
    null,
    2,
  ),
);
