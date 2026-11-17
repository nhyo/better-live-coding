import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadProject, validateProject } from '../src/presentation/project';
import { generateCandidates } from '../src/presentation/candidates';
import { readDirectoryFileSet } from '../src/checkpoints/generate';
import { applyOperation, FileSet } from '../src/engine/operations';
import { renderPreviewHtml, statusText } from '../src/presentation/preview';
import { flattenSteps } from '../src/config/types';
import { PAGE_START, ROOT, SERVER_START, nonLinearPresentation, tempDir, writeTree } from './helpers';

const examples = ['basic-typescript', 'vercel-blob'];

for (const name of examples) {
  test(`example ${name} validates, simulates every step and matches its final directory`, async () => {
    const report = await validateProject(path.join(ROOT, 'examples', name));
    assert.equal(report.errors, 0, JSON.stringify(report.diagnostics, null, 2));
    assert.equal(report.finalVerified, true);
    assert.ok(report.steps > 5);
  });
}

test('the Vercel Blob example uses CRLF files and both paces', async () => {
  const { project } = await loadProject(path.join(ROOT, 'examples', 'vercel-blob'));
  assert.ok(project?.checkpoints);
  assert.deepEqual(Object.values(project!.checkpoints!.eol), ['crlf', 'crlf']);
  const raw = fs.readFileSync(path.join(ROOT, 'examples', 'vercel-blob', 'initial', 'src', 'routes', '+page.svelte'), 'utf8');
  assert.ok(raw.includes('\r\n'), 'fixture is checked out with CRLF (.gitattributes)');
});

function fixture(definition = nonLinearPresentation(), extra: Record<string, string> = {}) {
  const root = tempDir();
  definition.workspace = { workingDirectory: 'work', initialDirectory: 'start', finalDirectory: 'end', ...definition.workspace };
  writeTree(root, {
    '.better-live-coding/presentation.json': JSON.stringify(definition),
    'start/page.svelte': PAGE_START,
    'start/server.ts': SERVER_START,
    'work/page.svelte': PAGE_START,
    'work/server.ts': SERVER_START,
    ...extra
  });
  return root;
}

test('validation reports missing and ambiguous anchors with chapter, step and file', async () => {
  const definition = nonLinearPresentation();
  definition.chapters[0].steps[3].operations[0].anchor = { text: '// nope' };
  const report = await validateProject(fixture(definition));
  const error = report.diagnostics.find((item) => item.severity === 'error')!;
  assert.match(error.message, /Anchor not found/);
  assert.equal(error.chapterId, 'upload');
  assert.equal(error.stepId, 'backend');
  assert.equal(error.file, 'server.ts');
  assert.ok(error.hint);

  const ambiguous = nonLinearPresentation();
  ambiguous.chapters[0].steps[0].operations[0].anchor = { text: 'script>' };
  const second = await validateProject(fixture(ambiguous));
  assert.ok(second.diagnostics.some((item) => /not unique/.test(item.message) && item.stepId === 'state'));
});

test('validation compares the final state and reports the first difference', async () => {
  const root = fixture(nonLinearPresentation(), { 'end/page.svelte': 'different', 'end/server.ts': 'different' });
  const report = await validateProject(root);
  assert.equal(report.finalVerified, false);
  assert.ok(report.diagnostics.some((item) => /differs from end: first difference at line 1/.test(item.message)));
});

test('validation passes when the end directory matches', async () => {
  const definition = nonLinearPresentation();
  const root = fixture(definition);
  const { project } = await loadProject(root);
  const last = project!.checkpoints!.states.at(-1)!;
  writeTree(root, { 'end/page.svelte': last['page.svelte']!, 'end/server.ts': last['server.ts']! });
  const report = await validateProject(root);
  assert.equal(report.errors, 0);
  assert.equal(report.finalVerified, true);
  assert.equal(report.currentCheckpoint, 0);
});

test('presentation files may not live in the config folder', async () => {
  const definition = nonLinearPresentation();
  definition.workspace = { workingDirectory: '.' };
  definition.chapters[0].steps[0].operations[0].file = '.better-live-coding/presentation.json';
  const root = tempDir();
  writeTree(root, { '.better-live-coding/presentation.json': JSON.stringify(definition) });
  const { diagnostics } = await loadProject(root);
  assert.ok(diagnostics.some((item) => /may not live inside/.test(item.message)));
});

test('a config that references .env.local is rejected before anything is read', async () => {
  const definition = nonLinearPresentation();
  definition.chapters[0].steps[0].operations[0].file = '.env.local';
  const root = fixture(definition, { 'work/.env.local': 'TOKEN=secret' });
  const report = await validateProject(root);
  assert.ok(report.errors > 0);
  assert.ok(report.diagnostics.some((item) => /environment, credential/.test(item.message)));
});

for (const name of examples) {
  test(`candidate diff for ${name} reproduces the final files, grouped, never one step per line`, async () => {
    const base = path.join(ROOT, 'examples', name);
    const start = await readDirectoryFileSet(path.join(base, 'initial'));
    const end = await readDirectoryFileSet(path.join(base, 'final'));
    const report = generateCandidates(start, end, { start: 'initial', end: 'final' });
    assert.match(report.note, /DRAFT/);
    let files: FileSet = { ...start };
    // Groups are suggestions; within a file, candidate order must be preserved.
    const operations = report.groups.flatMap((group) => group.operations);
    const byFile = new Map<string, typeof operations>();
    for (const operation of operations) byFile.set(operation.file, [...(byFile.get(operation.file) ?? []), operation]);
    for (const list of byFile.values()) {
      const original = list.slice().sort((a, b) => operations.indexOf(a) - operations.indexOf(b));
      for (const operation of original) files = applyOperation(files, operation);
    }
    for (const file of Object.keys({ ...start, ...end })) assert.equal(files[file] ?? null, end[file] ?? null, file);
    const changedLines = Object.keys(end).reduce((total, file) => total + Math.abs((end[file] ?? '').split('\n').length - (start[file] ?? '').split('\n').length), 0);
    assert.ok(report.groups.length < changedLines, 'groups are coarser than changed lines');
    assert.ok(!operations.some((operation) => operation.type === 'replaceFile'), 'every change is anchored');
  });
}

test('preview shows Stage x · Step y/z and escapes HTML', () => {
  const definition = nonLinearPresentation();
  definition.title = '<Demo & "Test">';
  const steps = flattenSteps(definition);
  assert.equal(statusText(steps, 2), 'Stage 1 · Step 3/5');
  assert.equal(statusText(steps, 5), 'Complete');
  const html = renderPreviewHtml(
    { presentation: definition, steps, completedSteps: 3, active: true, running: false, paused: false, checkpointLabel: 'Checkpoint 3' },
    'nonce123',
    'vscode-resource:'
  );
  assert.ok(html.includes('&lt;Demo &amp; &quot;Test&quot;&gt;'));
  assert.ok(html.includes('Stage 1 · Step 4/5'));
  assert.ok(html.includes('Implement the endpoint'));
  assert.ok(html.includes('server.ts'));
  assert.ok(html.includes("default-src 'none'"));
  assert.ok(!/<script/i.test(html), 'preview is static, without scripts');
});
