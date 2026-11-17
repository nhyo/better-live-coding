/**
 * Runs inside a real VS Code extension host (see runTest.ts). Drives the
 * extension through its commands and checks the files on disk.
 */
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const normalize = (text: string) => text.replace(/\r\n/g, '\n');

interface SessionLike {
  steps: { step: { id: string } }[];
  machine: { completedSteps: number; running: boolean; paused: boolean };
  checkpoints: { files: string[]; states: Record<string, string | null>[]; eol: Record<string, string> };
  restore(index: number): Promise<string[]>;
}

export async function run(): Promise<void> {
  const log = (message: string) => console.log(`  [${process.env.BLC_EXAMPLE}] ${message}`);
  const extension = vscode.extensions.getExtension('better-live-coding.better-live-coding');
  assert.ok(extension, 'extension better-live-coding.better-live-coding is installed');
  const api = (await extension.activate()) as { controller: { session?: SessionLike } };
  log(`activated ${extension.id} v${extension.packageJSON.version}`);

  const folder = vscode.workspace.workspaceFolders![0].uri.fsPath;
  const practice = path.join(folder, 'practice');
  const env = fs.readFileSync(path.join(practice, '.env.local'), 'utf8');

  await vscode.commands.executeCommand('betterLiveCoding.start');
  const session = api.controller.session!;
  assert.ok(session, 'presentation mode started');
  const total = session.steps.length;
  const expectState = (index: number, label: string) => {
    for (const file of session.checkpoints.files) {
      const target = path.join(practice, file);
      const actual = fs.existsSync(target) ? normalize(fs.readFileSync(target, 'utf8')) : null;
      assert.equal(actual, session.checkpoints.states[index][file], `${label}: ${file} matches checkpoint ${index}`);
    }
  };
  const next = () => vscode.commands.executeCommand('betterLiveCoding.nextStep') as Promise<void>;
  const waitRunning = async () => {
    for (let attempt = 0; attempt < 200 && !session.machine.running; attempt += 1) await sleep(5);
    assert.ok(session.machine.running);
  };

  // 1. A normal step through the command.
  await next();
  assert.equal(session.machine.completedSteps, 1);
  expectState(1, 'step 1');
  log('✓ Run Next Step typed step 1 and verified its checkpoint');

  // 2. A second Enter while a step runs is ignored.
  const running = next();
  await waitRunning();
  const started = Date.now();
  await next();
  assert.ok(Date.now() - started < 1000, 'second Enter returned immediately');
  await running;
  assert.equal(session.machine.completedSteps, 2);
  expectState(2, 'double enter');
  log('✓ second Enter during a running step was ignored');

  // 3. Pause / resume: nothing is typed while paused, then the step completes exactly.
  const paused = next();
  await waitRunning();
  await sleep(60);
  await vscode.commands.executeCommand('betterLiveCoding.pauseResume');
  assert.equal(session.machine.paused, true);
  await sleep(100);
  const editor = vscode.window.activeTextEditor!;
  const frozen = editor.document.getText();
  await sleep(700);
  assert.equal(editor.document.getText(), frozen, 'no characters typed while paused');
  await vscode.commands.executeCommand('betterLiveCoding.pauseResume');
  await paused;
  assert.equal(session.machine.completedSteps, 3);
  expectState(3, 'pause/resume');
  log('✓ pause stopped typing; resume finished at the exact position');

  // 4. Skip applies the complete checkpoint.
  const skipped = next();
  await waitRunning();
  await sleep(30);
  await vscode.commands.executeCommand('betterLiveCoding.skip');
  await skipped;
  assert.equal(session.machine.completedSteps, 4);
  expectState(4, 'skip');
  log('✓ skip applied the deterministic step checkpoint');

  // 5. Restart Current Step mid-animation.
  const interrupted = next();
  await waitRunning();
  await sleep(40);
  await vscode.commands.executeCommand('betterLiveCoding.restartStep');
  await interrupted;
  assert.equal(session.machine.completedSteps, 5);
  expectState(5, 'restart');
  log('✓ restart rolled back and re-ran the step');

  // 6. Remaining steps.
  while (session.machine.completedSteps < total) await next();
  expectState(total, 'final');
  const finalDirectory = path.join(folder, 'final');
  for (const file of session.checkpoints.files) {
    const expected = path.join(finalDirectory, file);
    const actual = path.join(practice, file);
    assert.equal(fs.existsSync(actual), fs.existsSync(expected), file);
    if (!fs.existsSync(expected)) continue;
    assert.equal(normalize(fs.readFileSync(actual, 'utf8')), normalize(fs.readFileSync(expected, 'utf8')), `${file} equals final/`);
    const raw = fs.readFileSync(actual, 'utf8');
    if (session.checkpoints.eol[file] === 'crlf') assert.ok(!/[^\r]\n/.test(raw), `${file} kept CRLF`);
    else assert.ok(!raw.includes('\r'), `${file} kept LF`);
  }
  log(`✓ all ${total} steps complete; ${session.checkpoints.files.length} files equal final/ despite formatOnSave/trimTrailingWhitespace`);

  // 7. Restore the initial checkpoint: only declared files change.
  await session.restore(0);
  expectState(0, 'restore');
  assert.equal(fs.readFileSync(path.join(practice, '.env.local'), 'utf8'), env, '.env.local untouched');
  log('✓ restore checkpoint 0 rewrote only declared files; .env.local untouched');

  // 8. Exit restores normal behaviour.
  await vscode.commands.executeCommand('betterLiveCoding.exit');
  log('✓ exit presentation mode');
}
