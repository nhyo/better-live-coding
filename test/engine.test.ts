import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Operation, Step } from '../src/config/types';
import { resolveAnchor } from '../src/engine/anchors';
import { FileSet, OperationError, StepError, applyOperation, applyStep, planOperation } from '../src/engine/operations';
import { buildCheckpoints } from '../src/checkpoints/checkpoints';
import { applyEol, detectEol, normalizeEol, offsetToPosition, positionToOffset } from '../src/utilities/text';
import { MemoryHost } from '../src/testing/hosts';
import { PAGE_START, SERVER_START, nonLinearPresentation } from './helpers';

const files = (): FileSet => ({ 'a.ts': 'const a = 1;\nconst b = 2;\n// marker\n', 'b.ts': 'export {};\n' });
const op = (operation: Partial<Operation>): Operation => ({ type: 'insertAfter', file: 'a.ts', ...operation }) as Operation;

test('insertBefore types before the anchor', () => {
  const result = applyOperation(files(), op({ type: 'insertBefore', anchor: { text: '// marker' }, text: 'const c = 3;\n' }));
  assert.equal(result['a.ts'], 'const a = 1;\nconst b = 2;\nconst c = 3;\n// marker\n');
});

test('insertAfter types after the anchor', () => {
  const result = applyOperation(files(), op({ anchor: { text: 'const a = 1;' }, text: ' // one' }));
  assert.equal(result['a.ts'], 'const a = 1; // one\nconst b = 2;\n// marker\n');
});

test('replace swaps exactly the anchor', () => {
  const result = applyOperation(files(), op({ type: 'replace', anchor: { text: 'b = 2' }, text: 'b = 20' }));
  assert.equal(result['a.ts'], 'const a = 1;\nconst b = 20;\n// marker\n');
});

test('delete removes exactly the anchor', () => {
  const result = applyOperation(files(), op({ type: 'delete', anchor: { text: '// marker\n' } }));
  assert.equal(result['a.ts'], 'const a = 1;\nconst b = 2;\n');
});

test('createFile creates a new file and refuses existing ones', () => {
  const result = applyOperation(files(), op({ type: 'createFile', file: 'c.ts', text: ['line 1', 'line 2'] }));
  assert.equal(result['c.ts'], 'line 1\nline 2');
  assert.throws(() => applyOperation(files(), op({ type: 'createFile', file: 'a.ts', text: 'x' })), /already exists/);
});

test('deleteFile removes a file and refuses missing ones', () => {
  const result = applyOperation(files(), op({ type: 'deleteFile', file: 'b.ts' }));
  assert.equal(result['b.ts'], null);
  assert.throws(() => applyOperation(result, op({ type: 'deleteFile', file: 'b.ts' })), /does not exist/);
});

test('moveCursor, selectRange and openFile never change content', () => {
  for (const type of ['moveCursor', 'selectRange', 'openFile'] as const) {
    const before = files();
    const after = applyOperation(before, op({ type, anchor: { text: 'const b' } }));
    assert.deepEqual(after, before);
  }
  const plan = planOperation(files(), op({ type: 'selectRange', anchor: { text: 'const b = 2;' } }));
  assert.equal(plan.kind, 'cursor');
  if (plan.kind === 'cursor') {
    assert.deepEqual(offsetToPosition(plan.before, plan.start), { line: 1, character: 0 });
    assert.deepEqual(offsetToPosition(plan.before, plan.end), { line: 1, character: 12 });
  }
});

test('missing anchor stops with an actionable error and no write', () => {
  const before = files();
  assert.throws(
    () => applyOperation(before, op({ anchor: { text: 'does not exist' }, text: 'x' })),
    (error: unknown) => error instanceof OperationError && /Anchor not found/.test(error.message) && !!error.hint
  );
  assert.deepEqual(before, files());
});

test('ambiguous anchor stops instead of guessing', () => {
  assert.throws(
    () => applyOperation(files(), op({ anchor: { text: 'const' }, text: 'x' })),
    (error: unknown) => error instanceof OperationError && /not unique/.test(error.message) && /occurs 2 times/.test(error.message)
  );
});

test('line-restricted, regex and line/column anchors', () => {
  assert.deepEqual(resolveAnchor('x\nconst\nconst\n', { text: 'const', line: 3 }, 't'), { start: 8, end: 13 });
  assert.deepEqual(resolveAnchor('a1 b22 c333', { regex: 'b\\d+' }, 't'), { start: 3, end: 6 });
  assert.throws(() => resolveAnchor('a1 a2', { regex: 'a\\d' }, 't'), /matched 2 times/);
  assert.deepEqual(resolveAnchor('ab\ncd\n', { line: 2, column: 2 }, 't'), { start: 4, end: 4 });
  assert.deepEqual(resolveAnchor('ab\ncd\n', { line: 1, column: 2, endLine: 2, endColumn: 2 }, 't'), { start: 1, end: 4 });
  assert.throws(() => resolveAnchor('ab\n', { line: 9 }, 't'), /Invalid anchor position/);
});

test('expectBefore and expectAfter guard the edit', () => {
  assert.throws(() => applyOperation(files(), op({ anchor: { text: '// marker' }, text: 'x', expectBefore: 'missing' })), /Expected text is missing before/);
  assert.throws(() => applyOperation(files(), op({ anchor: { text: '// marker' }, text: 'x', expectAfter: 'y' })), /Expected text is missing after/);
  assert.doesNotThrow(() => applyOperation(files(), op({ anchor: { text: '// marker' }, text: 'x', expectBefore: 'const b', expectAfter: 'markerx' })));
});

test('a multi-operation step is one transaction', () => {
  const step: Step = {
    id: 'multi',
    title: 'Multi',
    operations: [
      op({ anchor: { text: 'const a = 1;' }, text: ' // ok' }),
      op({ file: 'b.ts', type: 'replace', anchor: { text: 'export {};' }, text: 'export const b = 1;' })
    ]
  };
  const result = applyStep(files(), step);
  assert.equal(result['a.ts']?.includes('// ok'), true);
  assert.equal(result['b.ts'], 'export const b = 1;\n');

  const failing: Step = { ...step, operations: [...step.operations, op({ anchor: { text: 'nope' }, text: 'x' })] };
  const before = files();
  assert.throws(
    () => applyStep(before, failing),
    (error: unknown) => error instanceof StepError && error.stepId === 'multi' && error.operationIndex === 2 && error.file === 'a.ts'
  );
  assert.deepEqual(before, files(), 'input is never mutated');
});

test('non-linear file order: frontend → backend → frontend', () => {
  const definition = nonLinearPresentation();
  const set = buildCheckpoints(definition, { 'page.html': PAGE_START, 'server.ts': SERVER_START }, {});
  const order = set.steps.flatMap((flat) => flat.step.operations.map((operation) => operation.file));
  assert.deepEqual(order, ['page.html', 'page.html', 'page.html', 'server.ts', 'server.ts', 'page.html']);
  const final = set.states.at(-1)!;
  assert.match(final['page.html']!, /<button onclick="upload\(\)">Upload<\/button>\n {2}<p class="error"><\/p>/);
  assert.match(final['server.ts']!, /^import \{ json \}/);
  // The call (button) is written before its implementation (function), as configured.
  assert.ok(set.steps.findIndex((flat) => flat.step.id === 'button') < set.steps.findIndex((flat) => flat.step.id === 'function'));
});

test('LF and CRLF helpers use line/character positions, never raw offsets', () => {
  const crlf = 'one\r\ntwo\r\nthree\r\n';
  const normalized = normalizeEol(crlf);
  assert.equal(detectEol(crlf), 'crlf');
  assert.equal(detectEol('a\nb\n'), 'lf');
  const offset = normalized.indexOf('three');
  const position = offsetToPosition(normalized, offset);
  assert.deepEqual(position, { line: 2, character: 0 });
  assert.equal(positionToOffset(normalized, position), offset);
  // Using the normalized offset directly in the CRLF text would land in the wrong place.
  assert.notEqual(crlf.slice(offset, offset + 5), 'three');
  assert.equal(applyEol(normalized, 'crlf'), crlf);
});

test('a planned edit applied through line/character lands correctly in a CRLF document', async () => {
  const raw = 'alpha\r\nbeta\r\ngamma\r\n';
  const host = new MemoryHost({ 'x.ts': raw });
  await host.openFile('x.ts');
  const plan = planOperation({ 'x.ts': normalizeEol(raw) }, { type: 'replace', file: 'x.ts', anchor: { text: 'gamma' }, text: 'delta\nepsilon' });
  assert.equal(plan.kind, 'edit');
  if (plan.kind !== 'edit') return;
  const start = offsetToPosition(plan.before, plan.deleteStart);
  const end = offsetToPosition(plan.before, plan.deleteEnd);
  await host.delete('x.ts', start, end);
  await host.insert('x.ts', start, plan.insertText);
  assert.equal(await host.readFile('x.ts'), 'alpha\r\nbeta\r\ndelta\r\nepsilon\r\n');
  assert.equal(normalizeEol((await host.readFile('x.ts'))!), plan.after);
});
