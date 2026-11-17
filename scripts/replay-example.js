'use strict';
// Headless full replay of an example presentation on a temporary copy of its
// initial directory, with real Human Mode timing on a virtual clock.
//
// Usage: node scripts/replay-example.js <example-folder> [--eol=lf|crlf] [--scenario] [--keep]
//   --eol       convert the initial files to the given line ending before replaying
//   --scenario  also exercise pause/resume, skip, restart and checkpoint restore
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const out = (...parts) => require(path.join(root, 'out', 'src', ...parts));
const { loadProject } = out('presentation', 'project.js');
const { PresentationSession } = out('presentation', 'session.js');
const { DiskHost, VirtualClock } = out('testing', 'hosts.js');
const { DEFAULT_PACING, resolvePace } = out('engine', 'pacing.js');
const { normalizeEol, applyEol } = out('utilities', 'text.js');
const { isSensitivePath } = out('utilities', 'paths.js');
const { operationText } = out('config', 'types.js');

function copyTree(from, to, relative = '') {
  fs.mkdirSync(path.join(to, relative), { recursive: true });
  for (const entry of fs.readdirSync(path.join(from, relative), { withFileTypes: true })) {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (isSensitivePath(child)) continue;
    if (entry.isDirectory()) copyTree(from, to, child);
    else if (entry.isFile()) fs.writeFileSync(path.join(to, child), fs.readFileSync(path.join(from, child)));
  }
}

async function main() {
  const args = process.argv.slice(2);
  const folder = path.resolve(args.find((item) => !item.startsWith('--')) ?? '');
  const eol = (args.find((item) => item.startsWith('--eol=')) ?? '').split('=')[1];
  const scenario = args.includes('--scenario');
  const keep = args.includes('--keep');
  const name = path.basename(folder);

  // Load the presentation, then point it at a temporary working directory.
  const configFile = path.join(folder, '.better-live-coding', 'presentation.json');
  const presentation = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), `blc-replay-${name}-`));
  const work = path.join(temp, 'work');
  copyTree(path.join(folder, presentation.workspace.initialDirectory), work);
  if (eol) {
    for (const file of walk(work)) {
      const raw = fs.readFileSync(path.join(work, file), 'utf8');
      fs.writeFileSync(path.join(work, file), applyEol(raw, eol));
    }
  }
  // Mirror the example layout inside temp so relative directories resolve.
  fs.mkdirSync(path.join(temp, '.better-live-coding'), { recursive: true });
  const replayConfig = { ...presentation, workspace: { ...presentation.workspace, workingDirectory: 'work', initialDirectory: 'work-initial', finalDirectory: undefined } };
  copyTree(work, path.join(temp, 'work-initial'));
  fs.writeFileSync(path.join(temp, '.better-live-coding', 'presentation.json'), JSON.stringify(replayConfig));

  const { project, diagnostics } = await loadProject(temp);
  const errors = diagnostics.filter((item) => item.severity === 'error');
  if (errors.length || !project?.checkpoints) throw new Error(`Cannot load: ${errors.map((item) => item.message).join('; ')}`);

  const clock = new VirtualClock();
  const host = new DiskHost(work, clock);
  const session = new PresentationSession({ presentation: project.presentation, checkpoints: project.checkpoints, host, clock, settings: DEFAULT_PACING });
  const detected = await session.detectCheckpoint();
  if (detected.index !== 0) throw new Error(`Expected checkpoint 0 at start, got ${detected.index}`);

  console.log(`Replaying "${presentation.title}" (${project.checkpoints.steps.length} steps) in ${work}${eol ? ` with ${eol.toUpperCase()} files` : ''}`);
  const switches = [];
  let lastFile;
  const paceStats = { fast: { samples: 0, total: 0, min: Infinity, max: 0 }, slow: { samples: 0, total: 0, min: Infinity, max: 0 } };
  for (const flat of project.checkpoints.steps) {
    if (scenario && flat.index === 1) await exerciseScenario(session, host, clock);
    const startTime = clock.now;
    const eventStart = host.events.length;
    const result = await session.next();
    if (result.status !== 'completed') throw new Error(`Step ${flat.step.id} ended with ${result.status}: ${result.message ?? ''}`);
    const events = host.events.slice(eventStart);
    for (const event of events) {
      if (event.type === 'open' && event.file !== lastFile) {
        switches.push(event.file);
        lastFile = event.file;
      }
    }
    // Per-pace typing speed: gaps between consecutive letters of the same operation.
    const inserts = events.filter((event) => event.type === 'insert');
    const suggest = events.filter((event) => event.type === 'suggest').length;
    const hints = events.filter((event) => event.type === 'hints').length;
    const paces = flat.step.operations.map((operation) => resolvePace(operation, flat.step));
    const owner = [];
    for (const [index, operation] of flat.step.operations.entries()) {
      if (!['insertBefore', 'insertAfter', 'replace', 'createFile'].includes(operation.type)) continue;
      for (const _ of normalizeEol(operationText(operation))) owner.push(index);
    }
    if (owner.length !== inserts.length) throw new Error(`Typed ${inserts.length} characters, expected ${owner.length} in ${flat.step.id}`);
    for (let index = 0; index + 1 < inserts.length; index += 1) {
      if (owner[index] !== owner[index + 1] || !/^[A-Za-z0-9 ]$/.test(inserts[index].detail)) continue;
      const between = events.slice(events.indexOf(inserts[index]), events.indexOf(inserts[index + 1]));
      if (between.some((event) => event.type === 'suggest' || event.type === 'hints')) continue;
      const stats = paceStats[paces[owner[index]]];
      const gap = inserts[index + 1].time - inserts[index].time;
      stats.samples += 1;
      stats.total += gap;
      stats.min = Math.min(stats.min, gap);
      stats.max = Math.max(stats.max, gap);
    }
    const typed = inserts.length;
    console.log(
      `  ✓ ${String(flat.index + 1).padStart(2)} ${flat.chapter.id}/${flat.step.id} · ${flat.step.operations.length} ops · ${typed} chars · ` +
        `${[...new Set(paces)].join('+')} · ${((clock.now - startTime) / 1000).toFixed(1)}s · suggest ${suggest} · hints ${hints}`
    );
    const actual = await session.readActual();
    for (const file of project.checkpoints.files) {
      if ((actual[file] ?? null) !== (project.checkpoints.states[flat.index + 1][file] ?? null)) throw new Error(`Checkpoint mismatch after ${flat.step.id} in ${file}`);
    }
  }

  // Compare with the example's final directory (normalized line endings).
  const finalDirectory = path.join(folder, presentation.workspace.finalDirectory);
  let compared = 0;
  for (const file of project.checkpoints.files) {
    const expectedPath = path.join(finalDirectory, file);
    const expected = fs.existsSync(expectedPath) ? normalizeEol(fs.readFileSync(expectedPath, 'utf8')) : null;
    const actualPath = path.join(work, file);
    const actual = fs.existsSync(actualPath) ? normalizeEol(fs.readFileSync(actualPath, 'utf8')) : null;
    if (expected !== actual) throw new Error(`Final ${file} differs from ${presentation.workspace.finalDirectory}`);
    if (eol && actual !== null) {
      const raw = fs.readFileSync(actualPath, 'utf8');
      const wantCrlf = project.checkpoints.eol[file] === 'crlf';
      if (actual.includes('\n') && wantCrlf !== /\r\n/.test(raw)) throw new Error(`${file} lost its ${eol} line endings`);
      if (wantCrlf && /[^\r]\n/.test(raw)) throw new Error(`${file} has mixed line endings`);
    }
    compared += 1;
  }
  console.log(`  File switch order: ${switches.map((file) => file.split('/').pop()).join(' → ')}`);
  for (const [pace, stats] of Object.entries(paceStats)) {
    if (!stats.samples) continue;
    const [low, high] = pace === 'fast' ? [DEFAULT_PACING.fastTypingDelayMinMs, DEFAULT_PACING.fastTypingDelayMaxMs] : [DEFAULT_PACING.slowTypingDelayMinMs, DEFAULT_PACING.slowTypingDelayMaxMs];
    if (stats.min < low || stats.max > high) throw new Error(`${pace} pace out of range: ${stats.min}-${stats.max} ms`);
    console.log(`  ${pace} pace: ${stats.samples} letters, ${stats.min}–${stats.max} ms/char (avg ${(stats.total / stats.samples).toFixed(1)}), configured ${low}–${high}`);
  }
  console.log(`  Total virtual presentation time: ${(clock.now / 1000).toFixed(1)}s`);
  console.log(`✓ ${compared} declared files match ${presentation.workspace.finalDirectory}/ after a full replay.`);
  if (!keep) fs.rmSync(temp, { recursive: true, force: true });
  else console.log(`  Kept replay directory: ${temp}`);
}

async function exerciseScenario(session, host, clock) {
  // Pause after 5 inserts, check nothing is typed while paused, then resume.
  let inserts = 0;
  let pausedAt;
  let typedWhilePaused = 0;
  host.beforeInsert = () => {
    inserts += 1;
    if (session.machine.paused) typedWhilePaused += 1;
    if (inserts === 5) {
      session.togglePause();
      pausedAt = clock.now;
    }
  };
  clock.onSleep = () => {
    if (pausedAt !== undefined && session.machine.paused && clock.now - pausedAt > 2000) session.togglePause();
  };
  const step = session.nextStep;
  const result = await session.next();
  host.beforeInsert = undefined;
  clock.onSleep = undefined;
  if (result.status !== 'completed' || typedWhilePaused !== 0) throw new Error(`Pause/resume failed (${result.status}, ${typedWhilePaused} typed while paused)`);
  console.log(`  ✓ scenario: pause/resume during "${step.step.id}" (no characters typed while paused, resumed at the exact position)`);

  // Skip the next step mid-animation.
  inserts = 0;
  host.beforeInsert = () => {
    inserts += 1;
    if (inserts === 3) session.skip();
  };
  const skipped = await session.next();
  host.beforeInsert = undefined;
  if (skipped.status !== 'skipped') throw new Error(`Skip failed: ${skipped.status}`);
  console.log(`  ✓ scenario: skip applied the complete checkpoint ${skipped.checkpoint}`);

  // Restart the next step halfway through.
  inserts = 0;
  let restarted = false;
  host.beforeInsert = () => {
    inserts += 1;
    if (inserts === 4 && !restarted) {
      restarted = true;
      session.machine.requestAbort('restart step');
    }
  };
  const aborted = await session.next();
  host.beforeInsert = undefined;
  if (aborted.status !== 'aborted') throw new Error(`Restart (abort) failed: ${aborted.status}`);
  const again = await session.restartStep();
  if (again.status !== 'completed') throw new Error(`Restart failed: ${again.status}`);
  console.log(`  ✓ scenario: restart rolled back to checkpoint ${aborted.checkpoint} and re-ran the step`);

  // Restore back to checkpoint 1 so the normal replay continues from there.
  const changed = await session.restore(1);
  console.log(`  ✓ scenario: restore checkpoint 1 rewrote ${changed.length} declared file(s): ${changed.join(', ')}`);
}

function walk(base, relative = '') {
  const result = [];
  for (const entry of fs.readdirSync(path.join(base, relative), { withFileTypes: true })) {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) result.push(...walk(base, child));
    else result.push(child);
  }
  return result;
}

main().catch((error) => {
  console.error(`✗ ${error.message}`);
  process.exitCode = 1;
});
