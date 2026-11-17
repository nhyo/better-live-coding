import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ROOT } from './helpers';

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

test('all required commands are contributed with their exact titles', () => {
  const titles = manifest.contributes.commands.map((command: { category: string; title: string }) => `${command.category}: ${command.title}`);
  for (const title of [
    'Initialize Presentation',
    'Start Presentation Mode',
    'Run Next Step',
    'Pause or Resume',
    'Skip Current Animation',
    'Restart Current Step',
    'Restart from Initial Checkpoint',
    'Restore Checkpoint',
    'Validate Presentation',
    'Preview Steps',
    'Generate Checkpoints',
    'Exit Presentation Mode'
  ]) {
    assert.ok(titles.includes(`Better Live Coding: ${title}`), title);
  }
});

test('Enter is bound only in presentation mode, with a focused editor, never in the terminal', () => {
  const enter = manifest.contributes.keybindings.filter((binding: { key: string }) => binding.key === 'enter');
  assert.equal(enter.length, 2);
  for (const binding of enter) {
    assert.equal(binding.command, 'betterLiveCoding.nextStep');
    assert.match(binding.when, /betterLiveCoding\.presentationMode/);
    assert.match(binding.when, /editorTextFocus/);
    assert.match(binding.when, /!terminalFocus/);
  }
  // While idle, Enter must not steal suggestion acceptance or rename input.
  const idle = enter.find((binding: { when: string }) => binding.when.includes('!betterLiveCoding.running'));
  assert.match(idle.when, /!suggestWidgetVisible/);
  assert.match(idle.when, /!renameInputVisible/);
  // While a step runs, Enter is swallowed (ignored by the command) so it cannot accept a shown completion.
  assert.ok(enter.some((binding: { when: string }) => /&& betterLiveCoding\.running/.test(binding.when)));
});

test('configuration uses the betterLiveCoding namespace with the documented defaults', () => {
  const properties = manifest.contributes.configuration.properties;
  assert.equal(properties['betterLiveCoding.fastTypingDelayMinMs'].default, 12);
  assert.equal(properties['betterLiveCoding.fastTypingDelayMaxMs'].default, 25);
  assert.equal(properties['betterLiveCoding.slowTypingDelayMinMs'].default, 35);
  assert.equal(properties['betterLiveCoding.slowTypingDelayMaxMs'].default, 60);
  assert.ok(Object.keys(properties).every((key) => key.startsWith('betterLiveCoding.')));
  assert.equal(manifest.contributes.jsonValidation[0].fileMatch, '**/.better-live-coding/presentation.json');
});

test('identity and license metadata', () => {
  assert.equal(manifest.name, 'better-live-coding');
  assert.equal(manifest.publisher, 'better-live-coding');
  assert.equal(manifest.displayName, 'Better Live Coding');
  assert.equal(manifest.version, '1.0.0');
  assert.equal(manifest.license, 'MIT');
  assert.equal(manifest.dependencies, undefined, 'no runtime dependencies');
});

test('the VSIX allow-list never includes environment files, sources maps of tests or examples', () => {
  const ignore = fs.readFileSync(path.join(ROOT, '.vscodeignore'), 'utf8').split(/\r?\n/);
  assert.equal(ignore[0], '**', 'everything is excluded by default');
  const included = ignore.filter((line) => line.startsWith('!'));
  assert.ok(included.every((line) => !/env|examples|test|node_modules/.test(line)), included.join(', '));
});

function walk(folder: string): string[] {
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(folder, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}

test('runtime code does not hard-code any project-specific content', () => {
  const forbidden = [/\bfinial\b/i, /\bpractice\b/i, /vercel/i, /sveltekit/i, /\bblob\b/i, /tech[- ]?share/i, /CSCI/i, /\+page\.svelte/, /\+server\.ts/, /\bdemo\/src\b/, /TODO: Add/];
  const sources = walk(path.join(ROOT, 'src')).filter((file) => file.endsWith('.ts'));
  assert.ok(sources.length > 10);
  for (const file of sources) {
    // The generic deny-list of deployment CLI credential folders (".vercel", ".netlify") is security logic, not demo content.
    const content = fs.readFileSync(file, 'utf8').replace(/'\.vercel',/g, '');
    for (const pattern of forbidden) assert.ok(!pattern.test(content), `${path.relative(ROOT, file)} contains ${pattern}`);
  }
});

test('runtime code never spawns processes or opens network connections', () => {
  const sources = walk(path.join(ROOT, 'src')).filter((file) => file.endsWith('.ts'));
  for (const file of sources) {
    const content = fs.readFileSync(file, 'utf8');
    assert.ok(!/child_process|node:https?['"]|\bfetch\(|XMLHttpRequest|node:net|node:dgram/.test(content.replace(/'[^'\n]*'|`[^`]*`/g, "''")), path.relative(ROOT, file));
  }
});
