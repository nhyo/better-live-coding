import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import Ajv from 'ajv';
import { parsePresentation, validatePresentationObject } from '../src/config/load';
import { ROOT, nonLinearPresentation, presentation } from './helpers';

const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas', 'presentation.schema.json'), 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: false });
ajv.addKeyword('enumDescriptions');
const schemaValidate = ajv.compile(schema);

const errors = (data: unknown) => validatePresentationObject(data).diagnostics.filter((item) => item.severity === 'error');

test('a valid presentation parses without errors', () => {
  const result = parsePresentation(JSON.stringify(nonLinearPresentation()));
  assert.ok(result.presentation);
  assert.equal(result.diagnostics.filter((item) => item.severity === 'error').length, 0);
});

test('invalid JSON is reported with a hint', () => {
  const result = parsePresentation('{ "version": 1, ');
  assert.equal(result.presentation, undefined);
  assert.match(result.diagnostics[0].message, /not valid JSON/);
  assert.ok(result.diagnostics[0].hint);
});

test('missing required fields are reported', () => {
  const found = errors({ chapters: [] }).map((item) => item.location);
  assert.ok(found.includes('version'));
  assert.ok(found.includes('title'));
  assert.ok(found.includes('chapters'));
  const step = errors(presentation([{ id: 'a', title: 'A', steps: [{ id: 's', title: '', operations: [] } as never] }]));
  assert.ok(step.some((item) => item.location?.endsWith('.title')));
  assert.ok(step.some((item) => item.location?.endsWith('.operations')));
});

test('duplicate chapter ids are rejected', () => {
  const definition = presentation([
    { id: 'same', title: 'One', steps: [{ id: 'a', title: 'A', operations: [{ type: 'openFile', file: 'a.ts' }] }] },
    { id: 'same', title: 'Two', steps: [{ id: 'b', title: 'B', operations: [{ type: 'openFile', file: 'a.ts' }] }] }
  ]);
  const found = errors(definition);
  assert.equal(found.length, 1);
  assert.match(found[0].message, /Duplicate chapter id "same"/);
});

test('duplicate step ids are rejected across chapters', () => {
  const definition = presentation([
    { id: 'one', title: 'One', steps: [{ id: 'dup', title: 'A', operations: [{ type: 'openFile', file: 'a.ts' }] }] },
    { id: 'two', title: 'Two', steps: [{ id: 'dup', title: 'B', operations: [{ type: 'openFile', file: 'a.ts' }] }] }
  ]);
  const found = errors(definition);
  assert.equal(found.length, 1);
  assert.match(found[0].message, /Duplicate step id "dup"/);
  assert.equal(found[0].chapterId, 'two');
});

for (const bad of ['../outside.ts', 'src/../../x.ts', '/etc/passwd', 'C:/Windows/win.ini', 'C:\\Windows\\win.ini', '\\\\server\\share\\x']) {
  test(`path escape is rejected: ${bad}`, () => {
    const definition = presentation([{ id: 'c', title: 'C', steps: [{ id: 's', title: 'S', operations: [{ type: 'openFile', file: bad }] }] }]);
    assert.ok(errors(definition).some((item) => /relative|escapes|absolute/.test(item.message)), bad);
    assert.equal(schemaValidate(definition), false, `schema should also reject ${bad}`);
  });
}

for (const sensitive of ['.env.local', 'app/.env', 'node_modules/x/index.js', '.git/config', 'keys/server.pem', '.npmrc']) {
  test(`sensitive path is rejected: ${sensitive}`, () => {
    const definition = presentation([{ id: 'c', title: 'C', steps: [{ id: 's', title: 'S', operations: [{ type: 'openFile', file: sensitive }] }] }]);
    assert.ok(errors(definition).some((item) => /environment, credential, dependency or VCS/.test(item.message)));
  });
}

test('workingDirectory may not escape the workspace', () => {
  const definition = presentation([{ id: 'c', title: 'C', steps: [{ id: 's', title: 'S', operations: [{ type: 'openFile', file: 'a.ts' }] }] }], {
    workspace: { workingDirectory: '../elsewhere' }
  });
  assert.ok(errors(definition).some((item) => item.location === 'workspace.workingDirectory'));
});

test('replaceFile requires transient: true', () => {
  const op = { type: 'replaceFile', file: 'a.ts', text: 'x' };
  const definition = presentation([{ id: 'c', title: 'C', steps: [{ id: 's', title: 'S', operations: [op as never] }] }]);
  assert.ok(errors(definition).some((item) => /only allowed as a declared instant change/.test(item.message)));
  assert.equal(schemaValidate(definition), false);
  (op as Record<string, unknown>).transient = true;
  assert.equal(errors(definition).length, 0);
  assert.equal(schemaValidate(definition), true);
});

test('anchored operations need an anchor; anchors cannot mix text and regex', () => {
  const missing = presentation([{ id: 'c', title: 'C', steps: [{ id: 's', title: 'S', operations: [{ type: 'replace', file: 'a.ts', text: 'x' }] }] }]);
  assert.ok(errors(missing).some((item) => /requires an "anchor"/.test(item.message)));
  assert.equal(schemaValidate(missing), false);
  const both = presentation([
    { id: 'c', title: 'C', steps: [{ id: 's', title: 'S', operations: [{ type: 'replace', file: 'a.ts', text: 'x', anchor: { text: 'a', regex: 'a' } }] }] }
  ]);
  assert.ok(errors(both).some((item) => /either/.test(item.message)));
  assert.equal(schemaValidate(both), false);
  const badRegex = presentation([{ id: 'c', title: 'C', steps: [{ id: 's', title: 'S', operations: [{ type: 'delete', file: 'a.ts', anchor: { regex: '(' } }] }] }]);
  assert.ok(errors(badRegex).some((item) => /not a valid regular expression/.test(item.message)));
});

test('unknown operation types are rejected by validator and schema', () => {
  const definition = presentation([{ id: 'c', title: 'C', steps: [{ id: 's', title: 'S', operations: [{ type: 'teleport', file: 'a.ts' } as never] }] }]);
  assert.ok(errors(definition).some((item) => /Unknown operation type/.test(item.message)));
  assert.equal(schemaValidate(definition), false);
});

test('JSON Schema accepts every example and the validator agrees', () => {
  for (const name of fs.readdirSync(path.join(ROOT, 'examples'))) {
    const file = path.join(ROOT, 'examples', name, '.better-live-coding', 'presentation.json');
    if (!fs.existsSync(file)) continue;
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(schemaValidate(data), true, `${name}: ${JSON.stringify(schemaValidate.errors)}`);
    assert.equal(errors(data).length, 0, name);
  }
  assert.equal(schemaValidate(nonLinearPresentation()), true);
});

test('JSON Schema documents fields for editor completion', () => {
  const operation = schema.definitions.operation;
  assert.deepEqual(operation.properties.type.enum, [
    'insertBefore',
    'insertAfter',
    'replace',
    'delete',
    'createFile',
    'deleteFile',
    'moveCursor',
    'selectRange',
    'openFile',
    'replaceFile'
  ]);
  for (const [name, property] of Object.entries<Record<string, unknown>>(operation.properties)) {
    assert.ok(property.description || property.$ref, `operation.${name} needs a description`);
  }
  assert.ok(schema.definitions.relativePath.pattern);
});
