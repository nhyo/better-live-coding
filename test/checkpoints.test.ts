import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  buildCheckpoints,
  createManifest,
  declaredFiles,
  hashText,
  identifyByManifest,
  identifyCheckpoint,
  snapshotFromFiles,
  snapshotToFileSet
} from '../src/checkpoints/checkpoints';
import { copyTree, listFiles, readDeclared, resolveInside } from '../src/checkpoints/fileStore';
import { generateCheckpointFiles } from '../src/checkpoints/generate';
import { PAGE_START, SERVER_START, nonLinearPresentation, readTree, tempDir, writeTree } from './helpers';

test('declared files are the union of operation targets and workspace.files', () => {
  const definition = nonLinearPresentation();
  definition.workspace = { files: ['README.md'] };
  assert.deepEqual(declaredFiles(definition), ['README.md', 'page.html', 'server.ts']);
});

test('initial and per-step checkpoints are built and recognised', () => {
  const set = buildCheckpoints(nonLinearPresentation(), { 'page.html': PAGE_START, 'server.ts': SERVER_START }, {});
  assert.equal(set.states.length, 6);
  for (let index = 0; index < set.states.length; index += 1) assert.equal(identifyCheckpoint(set.states[index], set), index);
  assert.equal(identifyCheckpoint({ 'page.html': 'garbage', 'server.ts': SERVER_START }, set), -1);
  // CRLF content is recognised (line endings are normalised).
  const crlf = Object.fromEntries(Object.entries(set.states[3]).map(([file, text]) => [file, text!.replace(/\n/g, '\r\n')]));
  assert.equal(identifyCheckpoint(crlf, set), 3);
});

test('identical checkpoints prefer the saved index', () => {
  const definition = nonLinearPresentation();
  definition.chapters[0].steps.splice(1, 0, { id: 'look', title: 'Look', operations: [{ type: 'moveCursor', file: 'page.html', anchor: { text: '<main>' } }] });
  const set = buildCheckpoints(definition, { 'page.html': PAGE_START, 'server.ts': SERVER_START }, {});
  assert.equal(identifyCheckpoint(set.states[1], set), 1);
  assert.equal(identifyCheckpoint(set.states[1], set, 2), 2);
});

test('manifest hashes identify a checkpoint without rebuilding', () => {
  const definition = nonLinearPresentation();
  const set = buildCheckpoints(definition, { 'page.html': PAGE_START, 'server.ts': SERVER_START }, {});
  const manifest = createManifest(definition, set);
  assert.equal(manifest.checkpoints.length, 6);
  assert.equal(identifyByManifest(set.states[4], manifest), 4);
  assert.equal(hashText('a\r\nb'), hashText('a\nb'));
  assert.equal(manifest.checkpoints[0].stepId, null);
  assert.equal(manifest.checkpoints[5].stepId, 'feedback');
});

test('snapshots keep line endings per file', () => {
  const snapshot = snapshotFromFiles({ 'a.ts': 'x\r\ny\r\n', 'b.ts': 'x\n', 'c.ts': undefined }, ['a.ts', 'b.ts', 'c.ts']);
  assert.deepEqual(snapshot.files['a.ts'], { eol: 'crlf', text: 'x\ny\n' });
  assert.equal(snapshot.files['c.ts'], null);
  const { files, eol } = snapshotToFileSet(snapshot);
  assert.equal(files['a.ts'], 'x\ny\n');
  assert.equal(eol['a.ts'], 'crlf');
  assert.equal(eol['b.ts'], 'lf');
});

test('file access never escapes the base directory and never reads secrets', async () => {
  const base = tempDir();
  writeTree(base, { 'src/a.ts': 'a', '.env.local': 'TOKEN=secret', 'node_modules/x/index.js': 'x', 'src/.env': 'K=V' });
  await assert.rejects(() => resolveInside(base, '../outside.txt'), /escapes/);
  await assert.rejects(() => resolveInside(base, '.env.local'), /sensitive/);
  await assert.rejects(() => readDeclared(base, ['.env.local']), /sensitive/);
  assert.deepEqual(await listFiles(base), ['src/a.ts']);
  const target = tempDir();
  assert.deepEqual(await copyTree(base, target), ['src/a.ts']);
  assert.deepEqual(Object.keys(readTree(target)), ['src/a.ts']);
});

test('Generate Checkpoints writes relative paths only and no secrets', async () => {
  const root = tempDir();
  const definition = nonLinearPresentation();
  definition.workspace = { workingDirectory: 'work' };
  writeTree(root, {
    '.better-live-coding/presentation.json': JSON.stringify(definition),
    'work/page.html': PAGE_START,
    'work/server.ts': SERVER_START.replace(/\n/g, '\r\n'),
    'work/.env.local': 'API_TOKEN=secret'
  });
  const result = await generateCheckpointFiles(root, { capture: true });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(result.checkpoints, 6);
  const initial = fs.readFileSync(path.join(root, '.better-live-coding/checkpoints/initial.json'), 'utf8');
  const manifest = fs.readFileSync(path.join(root, '.better-live-coding/checkpoints/manifest.json'), 'utf8');
  for (const content of [initial, manifest]) {
    assert.ok(!content.includes(root), 'no absolute paths');
    assert.ok(!content.includes(root.replace(/\\/g, '/')), 'no absolute paths');
    assert.ok(!content.includes('secret') && !content.includes('.env'), 'no secrets');
  }
  assert.equal(JSON.parse(initial).files['server.ts'].eol, 'crlf');
});
