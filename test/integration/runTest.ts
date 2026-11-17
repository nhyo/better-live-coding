/**
 * Launches a real VS Code with isolated user-data and extensions directories,
 * loads the extension from this repository and runs `suite.ts` inside the
 * extension host against temporary copies of the examples.
 *
 *   VSCODE_EXECUTABLE=/path/to/code node out/test/integration/runTest.js
 *
 * Without VSCODE_EXECUTABLE, @vscode/test-electron downloads a stable build.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runTests } from '@vscode/test-electron';

function copyTree(from: string, to: string): void {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(source, target);
    else fs.writeFileSync(target, fs.readFileSync(source));
  }
}

async function main(): Promise<void> {
  const root = path.resolve(__dirname, '..', '..', '..');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'blc-integration-'));
  const workspace = path.join(temp, 'workspace');
  for (const name of ['basic-typescript', 'vercel-blob']) {
    const example = path.join(root, 'examples', name);
    copyTree(path.join(example, '.better-live-coding'), path.join(workspace, name, '.better-live-coding'));
    copyTree(path.join(example, 'initial'), path.join(workspace, name, 'initial'));
    copyTree(path.join(example, 'final'), path.join(workspace, name, 'final'));
    copyTree(path.join(example, 'initial'), path.join(workspace, name, 'practice'));
    // A secret that must never be read or modified.
    fs.writeFileSync(path.join(workspace, name, 'practice', '.env.local'), 'BLOB_READ_WRITE_TOKEN=never-read-me\n');
    const config = path.join(workspace, name, '.better-live-coding', 'presentation.json');
    const data = JSON.parse(fs.readFileSync(config, 'utf8'));
    delete data.$schema;
    fs.writeFileSync(config, JSON.stringify(data, null, 2));
  }
  const userData = path.join(temp, 'user-data');
  fs.mkdirSync(path.join(userData, 'User'), { recursive: true });
  // Aggressive save participants: they must NOT change checkpointed files.
  fs.writeFileSync(
    path.join(userData, 'User', 'settings.json'),
    JSON.stringify(
      {
        'editor.formatOnSave': true,
        'files.trimTrailingWhitespace': true,
        'files.insertFinalNewline': true,
        'files.trimFinalNewlines': true,
        'files.eol': '\n',
        'workbench.startupEditor': 'none',
        'security.workspace.trust.enabled': false,
        'betterLiveCoding.humanMode': false,
        'betterLiveCoding.fixedTypingDelayMs': 5,
        'betterLiveCoding.thinkingPauseMs': 0,
        'betterLiveCoding.fileSwitchPauseMs': 0,
        'betterLiveCoding.suggestionVisibleMs': 20,
        'betterLiveCoding.editorEffects': true
      },
      null,
      2
    )
  );
  let exitCode = 0;
  for (const name of ['basic-typescript', 'vercel-blob']) {
    console.log(`
=== Integration: ${name} ===`);
    const code = await runTests({
      vscodeExecutablePath: process.env.VSCODE_EXECUTABLE || undefined,
      extensionDevelopmentPath: process.env.BLC_EXTENSION_PATH || root,
      extensionTestsPath: path.join(__dirname, 'suite.js'),
      extensionTestsEnv: { BLC_EXAMPLE: name },
      launchArgs: [
        path.join(workspace, name),
        '--user-data-dir',
        userData,
        '--extensions-dir',
        path.join(temp, 'extensions'),
        '--disable-workspace-trust',
        '--skip-welcome',
        '--skip-release-notes'
      ]
    }).catch((error) => {
      console.error(error);
      return 1;
    });
    if (code !== 0) exitCode = code;
  }
  try {
    fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  } catch {
    console.warn(`Could not remove ${temp} (still locked by VS Code); remove it manually.`);
  }
  process.exit(exitCode);
}

void main();
