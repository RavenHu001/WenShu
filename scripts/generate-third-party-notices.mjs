/* global console, process */

import { access, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = resolve(scriptDirectory, '..');
const outputPath = resolve(projectDirectory, 'THIRD_PARTY_NOTICES.txt');
const packagePath = resolve(projectDirectory, 'package.json');
const lockPath = resolve(projectDirectory, 'package-lock.json');
const runtimeLicenseNames = ['LICENSE.electron.txt', 'LICENSES.chromium.html'];
const bundledRendererRoots = [
  '@codemirror/commands',
  '@codemirror/search',
  '@codemirror/state',
  '@codemirror/view',
  '@tiptap/core',
  '@tiptap/extension-color',
  '@tiptap/extension-text-align',
  '@tiptap/extension-text-style',
  '@tiptap/extension-underline',
  '@tiptap/pm',
  '@tiptap/react',
  '@tiptap/starter-kit',
  'react',
  'react-dom',
];

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const normalizePath = (path) => path.split(sep).join('/');
const normalizeLineEndings = (text) => text.replace(/\r\n?/g, '\n');

const resolvePackageManifest = async (name, fromDirectory) => {
  let current = fromDirectory;
  while (true) {
    const candidate = resolve(current, 'node_modules', ...name.split('/'), 'package.json');
    try {
      await access(candidate);
      return candidate;
    } catch {
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  throw new Error(`Unable to resolve installed package ${name} from ${fromDirectory}`);
};

const rootManifest = await readJson(packagePath);
const lock = await readJson(lockPath);
const roots = [...Object.keys(rootManifest.dependencies ?? {}), ...bundledRendererRoots];
const queue = [];
for (const name of roots) {
  queue.push(await resolvePackageManifest(name, projectDirectory));
}

const packages = new Map();
while (queue.length > 0) {
  const manifestPath = queue.shift();
  if (packages.has(manifestPath)) continue;

  const manifest = await readJson(manifestPath);
  const directory = dirname(manifestPath);
  const lockKey = normalizePath(relative(projectDirectory, directory));
  const locked = lock.packages?.[lockKey];
  if (!locked || locked.version !== manifest.version) {
    throw new Error(`Installed package does not match package-lock.json: ${lockKey}`);
  }

  const entries = await readdir(directory, { withFileTypes: true });
  const legalFiles = entries
    .filter(
      (entry) => entry.isFile() && /^(?:licen[cs]e|notice|copying)(?:\..*)?$/i.test(entry.name),
    )
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  const legalTexts = [];
  for (const name of legalFiles) {
    legalTexts.push({
      name,
      text: normalizeLineEndings(await readFile(resolve(directory, name), 'utf8')).trim(),
    });
  }

  packages.set(manifestPath, {
    name: manifest.name,
    version: manifest.version,
    license: locked.license ?? manifest.license ?? 'UNKNOWN',
    manifestLicense: manifest.license ?? 'UNKNOWN',
    repository:
      typeof manifest.repository === 'string'
        ? manifest.repository
        : (manifest.repository?.url ?? manifest.homepage ?? ''),
    legalTexts,
  });

  const dependencies = { ...manifest.dependencies, ...manifest.optionalDependencies };
  for (const dependencyName of Object.keys(dependencies).sort()) {
    try {
      queue.push(await resolvePackageManifest(dependencyName, directory));
    } catch (error) {
      if (manifest.optionalDependencies?.[dependencyName]) continue;
      throw error;
    }
  }
}

const sortedPackages = [...packages.values()].sort((left, right) =>
  `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`),
);
const missingLegalText = sortedPackages.filter((entry) => entry.legalTexts.length === 0);
const metadataMismatches = sortedPackages.filter(
  (entry) => entry.manifestLicense !== 'UNKNOWN' && entry.manifestLicense !== entry.license,
);
const licenseSummary = new Map();
for (const entry of sortedPackages) {
  licenseSummary.set(entry.license, (licenseSummary.get(entry.license) ?? 0) + 1);
}

const lines = [
  'WenShu THIRD-PARTY SOFTWARE NOTICES',
  '====================================',
  '',
  `Product version: ${rootManifest.version}`,
  `Lockfile version: ${lock.lockfileVersion}`,
  '',
  'Scope and method',
  '----------------',
  'This engineering inventory is generated from package-lock.json and the installed dependency',
  'graph for code shipped in the main process or bundled into the renderer. Build, test, lint,',
  'and packaging-only tools are excluded. The packaged Electron runtime separately carries',
  `${runtimeLicenseNames.join(' and ')} next to WenShu.exe; those files cover Electron/Chromium`,
  'and their bundled components and must remain with every unpacked, portable, and installed copy.',
  '',
  'This file is a reproducible engineering aid, not legal advice. Package metadata can be',
  'incomplete or inaccurate; downstream distributors must review the original licenses and notices.',
  'The WenShu project is licensed under the MIT License; see the packaged LICENSE file.',
  '',
  'Packaged runtime',
  '----------------',
  `Electron ${rootManifest.devDependencies.electron} | MIT | https://github.com/electron/electron`,
  'Chromium and Electron bundled components | multiple licenses | LICENSES.chromium.html',
  '',
  'License summary',
  '---------------',
  ...[...licenseSummary.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([license, count]) => `${license}: ${count}`),
  '',
  'Package inventory',
  '-----------------',
  ...sortedPackages.map(
    (entry) =>
      `${entry.name}@${entry.version} | ${entry.license}${entry.repository ? ` | ${entry.repository}` : ''}`,
  ),
  '',
  'Exceptions requiring review',
  '---------------------------',
  ...metadataMismatches.map(
    (entry) =>
      `${entry.name}@${entry.version}: package-lock.json says ${entry.license}, while the installed package.json says ${entry.manifestLicense}. The original package license text is preserved below; review this metadata difference before external distribution.`,
  ),
  ...(missingLegalText.length === 0
    ? ['Every npm package in the inventory supplied at least one license/notice/copying file.']
    : [
        `No legal text file was found for: ${missingLegalText
          .map((entry) => `${entry.name}@${entry.version}`)
          .join(', ')}. Review the upstream source before external distribution.`,
      ]),
  '',
  'Preserved package license and NOTICE texts',
  '------------------------------------------',
];

for (const entry of sortedPackages) {
  lines.push('', `===== ${entry.name}@${entry.version} (${entry.license}) =====`);
  if (entry.legalTexts.length === 0) {
    lines.push('[No license or NOTICE file was present in the installed package.]');
    continue;
  }
  for (const legalText of entry.legalTexts) {
    lines.push('', `--- ${legalText.name} ---`, legalText.text);
  }
}

// Third-party archives may contain CRLF or legacy CR license files. Normalize at the final
// generation boundary as well as on input so a Git clean checkout produces identical bytes on
// Windows, macOS, and Linux.
const output = normalizeLineEndings(`${lines.join('\n')}\n`);
if (process.argv.includes('--check')) {
  const existing = await readFile(outputPath, 'utf8').catch(() => '');
  if (existing !== output) {
    throw new Error('THIRD_PARTY_NOTICES.txt is missing or stale; run npm run notices:generate');
  }
  console.log(`THIRD_PARTY_NOTICES.txt is current (${sortedPackages.length} packages).`);
} else {
  await writeFile(outputPath, output, 'utf8');
  console.log(`Wrote THIRD_PARTY_NOTICES.txt (${sortedPackages.length} packages).`);
}
