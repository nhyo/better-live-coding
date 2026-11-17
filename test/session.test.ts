import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEol } from '../src/utilities/text';
import { PresentationSession } from '../src/presentation/session';
import { MemoryHost, VirtualClock } from '../src/testing/hosts';
import { resolvePacing } from '../src/engine/pacing';
import { PAGE_START, SERVER_START, MemoryStore, makeSession, nonLinearPresentation, presentation } from './helpers';

const startFiles = () => ({ 'page.svelte': PAGE_START, 'server.ts': SERVER_START });

test('each Enter runs exactly one semantic step and verifies its checkpoint', async () => {
  const { session, host, checkpoints } = makeSession(nonLinearPresentation(), startFiles());
  for (let index = 0; index < checkpoints.steps.length; index += 1) {
    const result = await session.next();
    assert.equal(result.status, 'completed');
    assert.equal(session.machine.completedSteps, index + 1);
    for (const file of checkpoints.files) assert.equal(host.diskText(file), checkpoints.states[index + 1][file]);
  }
  assert.deepEqual(await session.next(), { status: 'finished' });
});

test('a second Enter during a running step is ignored', async () => {
  const { session } = makeSession(nonLinearPresentation(), startFiles());
  const first = session.next();
  const second = await session.next();
  assert.deepEqual(second, { status: 'ignored', reason: 'running' });
  assert.equal((await first).status, 'completed');
  assert.equal(session.machine.completedSteps, 1);
});

test('the next file opens only after Enter, never in advance', async () => {
  const { session, host } = makeSession(nonLinearPresentation(), startFiles());
  for (let index = 0; index < 4; index += 1) {
    await session.next();
    const lastEvent = host.events.filter((event) => event.type !== 'status').at(-1);
    assert.notEqual(lastEvent?.type, 'open');
  }
  // Step 4 ("backend") switched to server.ts; page.svelte is not reopened until the next Enter.
  assert.equal(host.activeFile(), 'server.ts');
  const before = host.events.length;
  await session.next();
  const opens = host.events.slice(before).filter((event) => event.type === 'open').map((event) => event.file);
  assert.deepEqual(opens, ['page.svelte']);
});

test('pause stops typing; resume continues at the exact position', async () => {
  const clock = new VirtualClock();
  const { session, host, checkpoints } = makeSession(nonLinearPresentation(), startFiles(), { clock });
  let inserts = 0;
  let pausedInserts = 0;
  let pauseSleeps = 0;
  let snapshot = '';
  host.beforeInsert = () => {
    if (session.machine.paused) pausedInserts += 1;
    inserts += 1;
    if (inserts === 10) {
      session.togglePause();
    }
  };
  clock.onSleep = () => {
    if (!session.machine.paused) return;
    pauseSleeps += 1;
    if (pauseSleeps === 1) snapshot = host.documents.get('page.svelte')!.raw;
    if (pauseSleeps === 40) {
      // Nothing changed while paused.
      assert.equal(host.documents.get('page.svelte')!.raw, snapshot);
      session.togglePause();
    }
  };
  const result = await session.next();
  assert.equal(result.status, 'completed');
  assert.equal(pausedInserts, 0);
  assert.ok(pauseSleeps >= 40);
  assert.equal(host.diskText('page.svelte'), checkpoints.states[1]['page.svelte']);
  assert.ok(host.statuses.some((status) => status.startsWith('Paused')));
});

test('skip applies the deterministic end checkpoint of the step', async () => {
  const { session, host, checkpoints } = makeSession(nonLinearPresentation(), startFiles());
  await session.next();
  await session.next();
  await session.next();
  let inserts = 0;
  host.beforeInsert = () => {
    inserts += 1;
    if (inserts === 3) session.skip();
  };
  const result = await session.next();
  assert.equal(result.status, 'skipped');
  assert.equal(session.machine.completedSteps, 4);
  for (const file of checkpoints.files) assert.equal(normalizeEol((await host.readFile(file))!), checkpoints.states[4][file]);
});

test('restart rolls back to the step start and runs the step again', async () => {
  const { session, host, checkpoints } = makeSession(nonLinearPresentation(), startFiles());
  await session.next();
  let inserts = 0;
  let restart: ReturnType<typeof session.restartStep> | undefined;
  host.beforeInsert = () => {
    inserts += 1;
    if (inserts === 6) restart = session.restartStep();
  };
  const interrupted = await session.next();
  assert.equal(interrupted.status, 'aborted');
  assert.ok(restart);
  assert.equal((await restart).status, 'completed');
  host.beforeInsert = undefined;
  assert.equal(session.machine.completedSteps, 2);
  assert.equal(host.diskText('page.svelte'), checkpoints.states[2]['page.svelte']);
});

test('restore writes only declared files and never touches others', async () => {
  const files = { ...startFiles(), '.env.local': 'SECRET_TOKEN=abc', 'notes.md': '# untouched' };
  const { session, host, checkpoints } = makeSession(nonLinearPresentation(), files);
  assert.deepEqual(checkpoints.files, ['page.svelte', 'server.ts']);
  for (let index = 0; index < 5; index += 1) await session.next();
  const changed = await session.restore(0);
  assert.deepEqual(changed.sort(), ['page.svelte', 'server.ts']);
  assert.equal(host.disk.get('.env.local'), 'SECRET_TOKEN=abc');
  assert.equal(host.disk.get('notes.md'), '# untouched');
  assert.ok(!host.events.some((event) => event.file === '.env.local' || event.file === 'notes.md'));
  assert.equal(session.machine.completedSteps, 0);
  assert.deepEqual(await session.filesChangedBy(0), []);
});

test('unexpected modifications are detected before the next step', async () => {
  const { session, host } = makeSession(nonLinearPresentation(), startFiles());
  await session.next();
  host.externalEdit('server.ts', '// typed by hand\n');
  const result = await session.next();
  assert.equal(result.status, 'unexpected-changes');
  if (result.status === 'unexpected-changes') {
    assert.deepEqual(result.files, ['server.ts']);
    assert.equal(result.checkpoint, 1);
  }
  assert.equal(session.machine.completedSteps, 1);
  await session.restore(1);
  assert.equal((await session.next()).status, 'completed');
});

test('an edit that drifts during a step stops it instead of writing into the wrong place', async () => {
  const { session, host } = makeSession(nonLinearPresentation(), startFiles());
  for (let index = 0; index < 3; index += 1) await session.next();
  let inserts = 0;
  host.beforeInsert = (file) => {
    inserts += 1;
    // While the step types in server.ts, someone edits page.svelte... and server.ts drifts too.
    if (inserts === 2 && file === 'server.ts') host.externalEdit('server.ts', 'x');
  };
  const result = await session.next();
  assert.equal(result.status, 'error');
  assert.equal(session.machine.completedSteps, 3);
  await session.restore(3);
  host.beforeInsert = undefined;
  assert.equal((await session.next()).status, 'completed');
});

test('after a reload the current checkpoint is recognised from file contents', async () => {
  const store = new MemoryStore();
  const first = makeSession(nonLinearPresentation(), startFiles(), { store });
  await first.session.next();
  await first.session.next();
  // "Reload": a brand-new session over the same disk content.
  const disk = Object.fromEntries(first.host.disk);
  const second = makeSession(nonLinearPresentation(), startFiles(), { host: new MemoryHost(disk), store });
  const detected = await second.session.detectCheckpoint();
  assert.equal(detected.index, 2);
  assert.equal(detected.saved?.completedSteps, 2);
});

test('a crash mid-step leaves no matching checkpoint; the saved session says where to restore', async () => {
  const store = new MemoryStore();
  const { session, host } = makeSession(nonLinearPresentation(), startFiles(), { store });
  await session.next();
  let inserts = 0;
  let crashed: Record<string, string> = {};
  host.beforeInsert = () => {
    inserts += 1;
    if (inserts === 4) crashed = Object.fromEntries([...host.documents].map(([file, document]) => [file, document.raw]));
  };
  await session.next();
  const disk = { ...Object.fromEntries(host.disk), ...crashed };
  store.value = { ...store.value!, completedSteps: 1, running: true };
  const reloaded = makeSession(nonLinearPresentation(), startFiles(), { host: new MemoryHost(disk), store });
  const detected = await reloaded.session.detectCheckpoint();
  assert.equal(detected.index, -1);
  assert.equal(detected.saved?.running, true);
  await reloaded.session.restore(detected.saved!.completedSteps);
  assert.equal((await reloaded.session.detectCheckpoint()).index, 1);
});

test('saves never run formatters (save without formatting)', async () => {
  const { session, host } = makeSession(nonLinearPresentation(), startFiles());
  let formatterCalls = 0;
  host.formatOnSave = (text) => {
    formatterCalls += 1;
    return text.toUpperCase();
  };
  for (let index = 0; index < 5; index += 1) await session.next();
  const saves = host.events.filter((event) => event.type === 'save');
  assert.ok(saves.length >= 5);
  assert.ok(saves.every((event) => event.detail === 'withoutFormatting'));
  assert.equal(formatterCalls, 0);
});

test('IntelliSense and parameter hints are shown and closed before the step completes', async () => {
  const definition = presentation([
    {
      id: 'c',
      title: 'C',
      steps: [
        {
          id: 'endpoint',
          title: 'Endpoint',
          operations: [
            {
              type: 'replace',
              file: 'server.ts',
              anchor: { text: '// endpoint' },
              effects: { suggestAfter: ['Resp'], parameterHintsAfter: ['handleUpload('] },
              text: 'export const POST = async ({ request }) => {\n  const body = await request.json();\n  return Response.json(await handleUpload(body));\n};'
            }
          ]
        }
      ]
    }
  ]);
  const { session, host } = makeSession(definition, startFiles());
  await session.next();
  const types = host.events.map((event) => event.type);
  assert.ok(types.filter((type) => type === 'suggest').length >= 3, 'request. / Resp / Response.');
  assert.ok(types.includes('hints'));
  assert.equal(host.widgetsVisible, false);
  // Every trigger is followed by a hide before the next character.
  for (let index = 0; index < host.events.length; index += 1) {
    if (host.events[index].type !== 'suggest' && host.events[index].type !== 'hints') continue;
    const nextInsert = host.events.findIndex((event, position) => position > index && event.type === 'insert');
    const hide = host.events.findIndex((event, position) => position > index && event.type === 'hide');
    assert.ok(hide !== -1 && (nextInsert === -1 || hide < nextInsert));
  }
});

test('thinking status, selection before replace and cursor before insert', async () => {
  const definition = nonLinearPresentation();
  definition.chapters[0].steps[1].operations[0].thinking = 'Where does the button go?';
  const { session, host } = makeSession(definition, startFiles());
  await session.next();
  const before = host.events.length;
  await session.next();
  const events = host.events.slice(before);
  assert.ok(host.statuses.includes('Thinking · Where does the button go?'));
  const firstSelect = events.find((event) => event.type === 'select')!;
  assert.notDeepEqual(firstSelect.at, firstSelect.end, 'replace shows the selection first');
  const deleteIndex = events.findIndex((event) => event.type === 'delete');
  assert.ok(events.indexOf(firstSelect) < deleteIndex);
  // Cursor ends after the inserted text.
  const last = host.selection!;
  assert.deepEqual(last.anchor, last.active);
  assert.equal(last.anchor.line, 6);
});

test('LF and CRLF documents keep their line endings through animation and restore', async () => {
  const crlf = { 'page.svelte': PAGE_START.replace(/\n/g, '\r\n'), 'server.ts': SERVER_START };
  const { session, host, checkpoints } = makeSession(nonLinearPresentation(), crlf);
  for (let index = 0; index < 5; index += 1) assert.equal((await session.next()).status, 'completed');
  const page = host.disk.get('page.svelte')!;
  assert.ok(page.includes('\r\n'));
  assert.ok(!/[^\r]\n/.test(page), 'no bare LF in the CRLF document');
  assert.ok(!host.disk.get('server.ts')!.includes('\r'), 'LF document stays LF');
  await session.restore(2);
  const restored = host.disk.get('page.svelte')!;
  assert.ok(!/[^\r]\n/.test(restored));
  assert.equal(normalizeEol(restored), checkpoints.states[2]['page.svelte']);
});

test('createFile uses the configured EOL; deleteFile removes only the declared file', async () => {
  const definition = presentation(
    [
      {
        id: 'c',
        title: 'C',
        steps: [
          { id: 'create', title: 'Create', operations: [{ type: 'createFile', file: 'src/new.ts', text: 'export const a = 1;\nexport const b = 2;\n' }] },
          { id: 'remove', title: 'Remove', operations: [{ type: 'deleteFile', file: 'server.ts' }] }
        ]
      }
    ],
    { workspace: { newFileEol: 'crlf' } }
  );
  const { session, host } = makeSession(definition, { ...startFiles(), 'keep.ts': 'keep' });
  assert.equal((await session.next()).status, 'completed');
  assert.equal(host.disk.get('src/new.ts'), 'export const a = 1;\r\nexport const b = 2;\r\n');
  assert.equal((await session.next()).status, 'completed');
  assert.equal(host.disk.has('server.ts'), false);
  assert.equal(host.disk.get('keep.ts'), 'keep');
  await session.restore(0);
  assert.equal(host.disk.has('src/new.ts'), false);
  assert.equal(host.disk.get('server.ts'), SERVER_START);
});

test('exit during a step rolls back to its start checkpoint and stops typing', async () => {
  const { session, host, checkpoints } = makeSession(nonLinearPresentation(), startFiles());
  let inserts = 0;
  let afterExit = 0;
  let exited = false;
  host.beforeInsert = () => {
    if (exited) afterExit += 1;
    inserts += 1;
    if (inserts === 5) {
      exited = true;
      void session.exit();
    }
  };
  const result = await session.next();
  assert.equal(result.status, 'aborted');
  assert.equal(afterExit, 0);
  assert.equal(host.diskText('page.svelte'), checkpoints.states[0]['page.svelte']);
});

test('fixed-speed mode (Human Mode off) still produces identical results', async () => {
  const settings = resolvePacing({ humanMode: false, fixedTypingDelayMs: 1 });
  const clock = new VirtualClock();
  const { session, host, checkpoints } = makeSession(nonLinearPresentation(), startFiles(), { settings, clock });
  for (let index = 0; index < 5; index += 1) await session.next();
  assert.equal(host.diskText('page.svelte'), checkpoints.states[5]['page.svelte']);
  assert.ok(clock.now < 20000);
});

test('PresentationSession refuses checkpoints outside the range', async () => {
  const { session } = makeSession(nonLinearPresentation(), startFiles());
  await assert.rejects(() => session.restore(99), RangeError);
  assert.ok(session instanceof PresentationSession);
});
