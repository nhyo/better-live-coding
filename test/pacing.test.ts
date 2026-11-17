import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Operation } from '../src/config/types';
import { DEFAULT_PACING, characterDelay, classifyText, estimateTypingMs, resolvePace, resolvePacing } from '../src/engine/pacing';

const base = { seed: 's', stepId: 'step', operationIndex: 0 };
const text = (value: string): Operation => ({ type: 'insertAfter', file: 'a.ts', anchor: { text: 'x' }, text: value });

test('Human Mode is deterministic: same configuration, same rhythm', () => {
  const sample = 'export function upload(file: File) {\n  return file.name;\n}\n';
  const first = estimateTypingMs(DEFAULT_PACING, sample, { ...base, pace: 'slow' });
  const second = estimateTypingMs(DEFAULT_PACING, sample, { ...base, pace: 'slow' });
  assert.equal(first, second);
  const delays = [...'abcdefghij'].map((character, index) => characterDelay(DEFAULT_PACING, { ...base, index, character, pace: 'fast' }));
  assert.ok(new Set(delays).size > 3, 'delays vary between characters');
  const otherSeed = estimateTypingMs(DEFAULT_PACING, sample, { ...base, seed: 'other', pace: 'slow' });
  assert.notEqual(first, otherSeed, 'the seed changes the rhythm');
});

test('fast pace stays within 12–25 ms for plain characters', () => {
  for (let index = 0; index < 500; index += 1) {
    const delay = characterDelay(DEFAULT_PACING, { ...base, index, character: 'a', pace: 'fast' });
    assert.ok(delay >= 12 && delay <= 25, `${delay}`);
  }
});

test('slow pace stays within 35–60 ms for plain characters', () => {
  for (let index = 0; index < 500; index += 1) {
    const delay = characterDelay(DEFAULT_PACING, { ...base, index, character: 'a', pace: 'slow' });
    assert.ok(delay >= 35 && delay <= 60, `${delay}`);
  }
});

test('punctuation, line and blank-line pauses are added', () => {
  const plain = characterDelay(DEFAULT_PACING, { ...base, index: 1, character: 'a', pace: 'slow' });
  const comma = characterDelay(DEFAULT_PACING, { ...base, index: 1, character: ';', pace: 'slow' });
  const newline = characterDelay(DEFAULT_PACING, { ...base, index: 1, character: '\n', previous: 'x', pace: 'slow' });
  const blank = characterDelay(DEFAULT_PACING, { ...base, index: 1, character: '\n', previous: '\n', pace: 'slow' });
  assert.ok(comma >= 35 + DEFAULT_PACING.punctuationPauseMs && comma > plain);
  assert.ok(newline >= 35 + DEFAULT_PACING.linePauseMs);
  assert.ok(blank >= 35 + DEFAULT_PACING.blankLinePauseMs && blank > newline);
});

test('Human Mode off uses the fixed delay', () => {
  const settings = resolvePacing({ humanMode: false, fixedTypingDelayMs: 30 });
  assert.equal(characterDelay(settings, { ...base, index: 0, character: '\n', pace: 'slow' }), 30);
  assert.equal(characterDelay(settings, { ...base, index: 3, character: 'x', pace: 'fast' }), 30);
});

test('custom ranges are honoured and clamped', () => {
  const settings = resolvePacing({ fastTypingDelayMinMs: 5, fastTypingDelayMaxMs: 6, slowTypingDelayMaxMs: 99999 });
  assert.equal(settings.slowTypingDelayMaxMs, 400);
  const delay = characterDelay(settings, { ...base, index: 0, character: 'q', pace: 'fast' });
  assert.ok(delay >= 5 && delay <= 6);
});

test('imports use the slow pace', () => {
  assert.equal(resolvePace(text("import { upload } from '@vercel/blob/client';")), 'slow');
  assert.equal(resolvePace(text("const fs = require('node:fs');")), 'slow');
  assert.equal(classifyText("\n  import { x } from './x';").reason, 'import');
});

test('functions use the slow pace', () => {
  assert.equal(resolvePace(text('async function uploadImage() {\n  return 1;\n}')), 'slow');
  assert.equal(resolvePace(text('const handler = async (event) => {\n};')), 'slow');
  assert.equal(classifyText('export function totalCents(): number {\n}').reason, 'function');
});

test('backend endpoints use the slow pace', () => {
  assert.equal(classifyText('export const POST: RequestHandler = async ({ request }) => {\n};').reason, 'endpoint');
  assert.equal(classifyText("app.get('/items', (req, res) => res.json([]));").reason, 'endpoint');
  assert.equal(classifyText('export async function DELETE(request) {}').reason, 'endpoint');
});

test('HTML, state and CSS use the fast pace', () => {
  assert.equal(resolvePace(text('<button onclick={uploadImage} disabled={!selectedFile}>\n  Upload\n</button>')), 'fast');
  assert.equal(resolvePace(text('<button onclick={() => deleteImage(item.pathname)}>Delete</button>')), 'fast');
  assert.equal(resolvePace(text("let error = $state('');\nlet images = $state<GalleryImage[]>([]);")), 'fast');
  assert.equal(resolvePace(text('type GalleryImage = {\n  url: string;\n};')), 'fast');
  assert.equal(resolvePace(text('  article img,\n  article video {')), 'fast');
  assert.equal(resolvePace(text('.error {\n  color: #b42318;\n}')), 'fast');
});

test('explicit operation and step pace override the heuristic', () => {
  assert.equal(resolvePace({ ...text('<p>hi</p>'), pace: 'slow' }), 'slow');
  assert.equal(resolvePace(text('function f() {}'), { id: 's', title: 's', pace: 'fast', operations: [] }), 'fast');
  assert.equal(resolvePace({ ...text('function f() {}'), pace: 'auto' }, { id: 's', title: 's', pace: 'auto', operations: [] }), 'slow');
});
