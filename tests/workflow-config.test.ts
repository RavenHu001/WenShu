import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = resolve(import.meta.dirname, '..');
const readWorkflow = (name: string): Promise<string> =>
  readFile(resolve(projectRoot, '.github', 'workflows', name), 'utf8');

const actionReferences = (workflow: string): string[] =>
  [...workflow.matchAll(/uses:\s*[^\s@]+@([^\s#]+)/g)].flatMap((match) =>
    match[1] ? [match[1]] : [],
  );

describe('Task 12 GitHub Actions workflow guardrails', () => {
  it('keeps CI read-only, locked to the project Node version, and limited to npm downloads', async () => {
    const workflow = await readWorkflow('ci.yml');

    expect(workflow).toContain('runs-on: windows-2025');
    expect(workflow).toContain('contents: read');
    expect(workflow).not.toMatch(/contents:\s*write/);
    expect(workflow).toContain('node-version-file: .node-version');
    expect(workflow).toContain('cache: npm');
    expect(workflow).toContain('package-manager-cache: false');
    expect(workflow).not.toMatch(/cache:\s*(?:node_modules|out|release)/);
    expect(workflow).toContain('npm ci');
    expect(workflow).toContain('npm run check');
    expect(workflow).toContain('npm run build');
    expect(workflow).toContain('tests/e2e/electron-smoke.test.ts');
    expect(workflow.indexOf('npm run build')).toBeLessThan(workflow.indexOf('npm run check'));
  });

  it('only permits release writes after an approved environment and a clean tagged rebuild', async () => {
    const workflow = await readWorkflow('release.yml');

    expect(workflow).toContain("- 'v*'");
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('ref: ${{ env.RELEASE_TAG }}');
    expect(workflow).toContain('$env:RELEASE_TAG -ne "v$version"');
    expect(workflow).toContain('git rev-parse HEAD');
    expect(workflow).toContain('release-commit: ${{ steps.release-metadata.outputs.commit }}');
    expect(workflow).toContain('npm ci');
    expect(workflow).toContain('npm run check');
    expect(workflow).toContain('npm run build');
    expect(workflow).toContain('npm run package:win');
    expect(workflow).toContain('environment: alpha-release');
    expect(workflow).toContain('contents: write');
    expect(workflow.match(/contents:\s*write/g)).toHaveLength(1);
    expect(workflow).toContain('--draft --prerelease');
    expect(workflow).toContain('SHA256SUMS.txt');
    expect(workflow).toContain('vars.ENABLE_ARTIFACT_ATTESTATION');
    expect(workflow).not.toMatch(/secrets\.(?!GITHUB_TOKEN)/);

    const buildJob = workflow.slice(
      workflow.indexOf('  build:'),
      workflow.indexOf('  draft-release:'),
    );
    expect(buildJob).toContain('contents: read');
    expect(buildJob).not.toMatch(/contents:\s*write/);
    expect(buildJob.indexOf('npm run build')).toBeLessThan(buildJob.indexOf('npm run check'));
  });

  it('pins every workflow action to a full immutable commit SHA', async () => {
    const workflows = await Promise.all([readWorkflow('ci.yml'), readWorkflow('release.yml')]);
    const references = workflows.flatMap(actionReferences);

    expect(references.length).toBeGreaterThan(0);
    for (const reference of references) {
      expect(reference).toMatch(/^[0-9a-f]{40}$/);
    }
  });
});
