/**
 * VS Code controller: commands, dialogs, status bar, context keys and the
 * preview panel on top of the host-independent PresentationSession.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { CONFIG_DIRECTORY, CONFIG_FILE } from '../config/load';
import { identifyByManifest, CheckpointManifest } from '../checkpoints/checkpoints';
import { copyTree, exists } from '../checkpoints/fileStore';
import { generateCandidateFile, generateCheckpointFiles } from '../checkpoints/generate';
import { realClock } from '../engine/host';
import { PacingSettings, resolvePacing } from '../engine/pacing';
import { MANIFEST, Project, formatDiagnostic, loadProject, validateProject } from '../presentation/project';
import { PreviewState, statusText } from '../presentation/preview';
import { NextResult, PresentationSession, SavedSession, SessionStore } from '../presentation/session';
import { CONFIG_README, STARTER_PRESENTATION } from '../presentation/template';
import { PreviewViewProvider } from './previewView';
import { VscodeHost } from './vscodeHost';

const CONTEXT_ACTIVE = 'betterLiveCoding.presentationMode';
const CONTEXT_RUNNING = 'betterLiveCoding.running';

export class Controller implements vscode.Disposable {
  private session: PresentationSession | undefined;
  private host: VscodeHost | undefined;
  private project: Project | undefined;
  private active = false;
  private readonly output: vscode.OutputChannel;
  private readonly statusItem: vscode.StatusBarItem;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly preview: PreviewViewProvider
  ) {
    this.output = vscode.window.createOutputChannel('Better Live Coding');
    this.statusItem = vscode.window.createStatusBarItem('betterLiveCoding.status', vscode.StatusBarAlignment.Left, 100);
    this.statusItem.name = 'Better Live Coding';
    this.statusItem.command = 'betterLiveCoding.nextStep';
    this.disposables.push(
      this.output,
      this.statusItem,
      vscode.workspace.onDidChangeTextDocument((event) => this.onDocumentChanged(event))
    );
  }

  dispose(): void {
    for (const item of this.disposables) item.dispose();
  }

  // ---------------------------------------------------------------- commands

  async initialize(): Promise<void> {
    const folder = await this.pickFolder(false);
    if (!folder) return;
    const root = folder.uri.fsPath;
    const configDirectory = path.join(root, CONFIG_DIRECTORY);
    const configFile = path.join(root, CONFIG_FILE);
    if (await exists(configFile)) {
      const choice = await vscode.window.showWarningMessage(
        `${CONFIG_FILE} already exists. Initialization never overwrites an existing presentation.`,
        'Open Existing',
        'Add Missing Files Only'
      );
      if (choice === 'Open Existing') {
        await vscode.window.showTextDocument(vscode.Uri.file(configFile));
        return;
      }
      if (choice !== 'Add Missing Files Only') return;
    } else if (await exists(configDirectory)) {
      const choice = await vscode.window.showWarningMessage(
        `${CONFIG_DIRECTORY}/ already exists without presentation.json. Create the missing files?`,
        'Create Missing Files',
        'Cancel'
      );
      if (choice !== 'Create Missing Files') return;
    }
    await fs.mkdir(path.join(configDirectory, 'checkpoints'), { recursive: true });
    const schemaSource = path.join(this.context.extensionPath, 'schemas', 'presentation.schema.json');
    await writeIfMissing(configFile, `${JSON.stringify(STARTER_PRESENTATION, null, 2)}\n`);
    await writeIfMissing(path.join(configDirectory, 'presentation.schema.json'), await fs.readFile(schemaSource, 'utf8'));
    await writeIfMissing(path.join(configDirectory, 'README.md'), CONFIG_README);
    await writeIfMissing(path.join(configDirectory, 'checkpoints', '.gitkeep'), '');
    await vscode.window.showTextDocument(vscode.Uri.file(configFile), { preview: false });
    vscode.window.showInformationMessage(
      'Presentation created. Set workspace.workingDirectory and the files you present, then run "Generate Checkpoints" and "Validate Presentation".'
    );
  }

  async start(): Promise<boolean> {
    if (this.active) {
      vscode.window.showInformationMessage('Better Live Coding presentation mode is already active.');
      return true;
    }
    const folder = await this.pickFolder(true);
    if (!folder) {
      vscode.window.showErrorMessage(`No ${this.configFile()} found. Run "Better Live Coding: Initialize Presentation" first.`);
      return false;
    }
    const root = folder.uri.fsPath;
    let { project, diagnostics } = await loadProject(root, { configFile: this.configFile() });
    const workspaceConfig = project?.presentation.workspace;
    if (project && !project.workingDirectoryExists && workspaceConfig?.initialDirectory) {
      const choice = await vscode.window.showInformationMessage(
        `Working directory "${workspaceConfig.workingDirectory}" does not exist. Create it as a copy of "${workspaceConfig.initialDirectory}"?`,
        { modal: true, detail: 'Environment files, credentials, node_modules and VCS folders are never copied.' },
        'Create Working Directory'
      );
      if (choice !== 'Create Working Directory') return false;
      const copied = await copyTree(path.resolve(root, workspaceConfig.initialDirectory), project.workingDirectory);
      this.output.appendLine(`Created ${workspaceConfig.workingDirectory} with ${copied.length} files from ${workspaceConfig.initialDirectory}.`);
      ({ project, diagnostics } = await loadProject(root, { configFile: this.configFile() }));
    }
    this.logDiagnostics('Start Presentation Mode', diagnostics);
    if (!project?.checkpoints || diagnostics.some((item) => item.severity === 'error')) {
      const errors = diagnostics.filter((item) => item.severity === 'error');
      const choice = await vscode.window.showErrorMessage(
        `The presentation cannot start: ${errors[0]?.message ?? 'unknown error'}${errors.length > 1 ? ` (+${errors.length - 1} more)` : ''}`,
        'Show Details'
      );
      if (choice === 'Show Details') this.output.show(true);
      return false;
    }
    this.project = project;
    this.host = new VscodeHost(project.workingDirectory, (text) => this.updateStatus(text), this.output);
    const store = this.sessionStore(root);
    this.session = new PresentationSession({
      presentation: project.presentation,
      checkpoints: project.checkpoints,
      host: this.host,
      clock: realClock,
      settings: this.pacing(),
      store
    });

    let { index, saved } = await this.session.detectCheckpoint();
    if (index === -1) {
      const manifestIndex = await this.manifestCheckpoint(root);
      const fallback = manifestIndex >= 0 ? manifestIndex : saved ? Math.min(saved.completedSteps, project.checkpoints.steps.length) : 0;
      const files = await this.session.filesChangedBy(fallback);
      const label = this.checkpointLabel(fallback);
      const choice = await vscode.window.showWarningMessage(
        `The presentation files do not match any checkpoint${saved?.running ? ' (a step was interrupted)' : ''}. Restore ${label}?`,
        { modal: true, detail: `Only these declared files will be rewritten:\n${files.map((file) => `• ${file}`).join('\n')}\n\nNo other file is touched.` },
        'Restore'
      );
      if (choice !== 'Restore') {
        this.session = undefined;
        return false;
      }
      await this.session.restore(fallback);
      index = fallback;
    } else {
      this.session.machine.restore(index);
    }

    this.active = true;
    await this.setContext();
    if (!vscode.window.activeTextEditor) {
      // Give Enter a focused editor to work with; later file switches happen only on Enter.
      const first = this.session.nextStep?.step.operations.find((operation) => operation.type !== 'createFile')?.file;
      if (first && (await this.host.readFile(first)) !== undefined) await this.host.openFile(first);
    }
    this.updateStatus();
    this.refreshPreview();
    this.output.appendLine(`Presentation "${project.presentation.title}" started at ${this.checkpointLabel(index)}.`);
    const next = this.session.nextStep;
    vscode.window.setStatusBarMessage(
      next ? `Better Live Coding ready · press Enter for "${next.step.title}"` : 'Better Live Coding · all steps complete. Use Restart or Restore Checkpoint.',
      6000
    );
    return true;
  }

  async nextStep(): Promise<void> {
    if (!this.active || !this.session) {
      if (await this.start()) return;
      return;
    }
    // Reject a second Enter synchronously while a step runs.
    if (this.session.running) {
      vscode.window.setStatusBarMessage('Better Live Coding: a step is already running.', 1500);
      return;
    }
    if (!this.session.nextStep) {
      vscode.window.showInformationMessage('All presentation steps are complete.');
      return;
    }
    const pending = this.session.next();
    await this.setContext();
    this.refreshPreview();
    const result = await pending;
    await this.setContext();
    await this.handleResult(result);
  }

  private async handleResult(result: NextResult): Promise<void> {
    const session = this.session;
    if (!session) return;
    switch (result.status) {
      case 'ignored':
        return;
      case 'finished':
        vscode.window.showInformationMessage('All presentation steps are complete.');
        break;
      case 'unexpected-changes': {
        this.updateStatus('Unexpected edits detected');
        const choice = await vscode.window.showWarningMessage(
          `Declared files changed since ${this.checkpointLabel(result.checkpoint)}. Restore it and run the step?`,
          { modal: true, detail: `Files that will be rewritten:\n${result.files.map((file) => `• ${file}`).join('\n')}` },
          'Restore and Continue'
        );
        if (choice === 'Restore and Continue') {
          await session.restore(result.checkpoint);
          this.updateStatus();
          await this.nextStep();
          return;
        }
        break;
      }
      case 'error': {
        this.output.appendLine(`ERROR in step "${result.step.step.id}": ${result.message}`);
        const choice = await vscode.window.showErrorMessage(
          `Step "${result.step.step.title}" stopped: ${result.message}`,
          { modal: true, detail: result.files.length ? `Changed files: ${result.files.join(', ')}` : undefined },
          `Restore ${this.checkpointLabel(result.checkpoint)}`
        );
        if (choice) await session.restore(result.checkpoint);
        break;
      }
      case 'aborted':
        this.output.appendLine(`Step "${result.step.step.id}" interrupted; ${this.checkpointLabel(result.checkpoint)} restored.`);
        break;
      case 'skipped':
      case 'completed': {
        this.output.appendLine(`Step "${result.step.step.id}" ${result.status} · now at ${this.checkpointLabel(result.checkpoint)}.`);
        const next = session.nextStep;
        if (next) vscode.window.setStatusBarMessage(`✓ ${result.step.step.title} · Enter for "${next.step.title}"`, 5000);
        else vscode.window.showInformationMessage('All live-coding steps are complete and verified.');
        break;
      }
    }
    this.updateStatus();
    this.refreshPreview();
  }

  async pauseResume(): Promise<void> {
    const paused = this.session?.togglePause();
    if (paused === undefined) {
      vscode.window.setStatusBarMessage('Better Live Coding: no step is typing.', 2000);
      return;
    }
    if (paused) {
      await this.host?.hideWidgets();
      this.updateStatus('Paused · Ctrl+Alt+P to resume');
    } else {
      this.updateStatus('Resumed');
    }
    this.refreshPreview();
  }

  async skip(): Promise<void> {
    if (!this.session?.skip()) {
      vscode.window.setStatusBarMessage('Better Live Coding: no running step to skip.', 2000);
      return;
    }
    this.updateStatus('Completing step from its checkpoint');
  }

  async restartStep(): Promise<void> {
    if (!this.active || !this.session) return;
    const pending = this.session.restartStep();
    await this.setContext();
    const result = await pending;
    await this.setContext();
    await this.handleResult(result);
  }

  async restartAll(): Promise<void> {
    if (!this.active || !this.session) {
      if (!(await this.start())) return;
    }
    const session = this.session!;
    const files = await session.filesChangedBy(0);
    const choice = await vscode.window.showWarningMessage(
      'Restart from the initial checkpoint?',
      {
        modal: true,
        detail: files.length ? `Only declared files are rewritten:\n${files.map((file) => `• ${file}`).join('\n')}` : 'All declared files already match the initial checkpoint.'
      },
      'Restart'
    );
    if (choice !== 'Restart') return;
    await session.restore(0);
    await this.setContext();
    this.updateStatus();
    this.refreshPreview();
  }

  async restoreCheckpoint(): Promise<void> {
    if (!this.active || !this.session) {
      if (!(await this.start())) return;
    }
    const session = this.session!;
    const items = session.checkpoints.states.map((_, index) => ({
      label: this.checkpointLabel(index),
      description: index === session.machine.completedSteps ? 'current' : index === session.steps.length ? 'final' : '',
      index
    }));
    const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Restore a checkpoint (only declared files are written)' });
    if (!picked) return;
    await session.interrupt('restore checkpoint');
    const files = await session.filesChangedBy(picked.index);
    if (files.length > 0) {
      const confirm = await vscode.window.showWarningMessage(
        `Restore ${picked.label}?`,
        { modal: true, detail: `Files that will be rewritten:\n${files.map((file) => `• ${file}`).join('\n')}` },
        'Restore'
      );
      if (confirm !== 'Restore') return;
    }
    await session.restore(picked.index);
    await this.setContext();
    this.updateStatus();
    this.refreshPreview();
  }

  async exit(): Promise<void> {
    if (!this.active) return;
    await this.session?.exit();
    this.active = false;
    await this.setContext();
    this.statusItem.hide();
    this.refreshPreview();
    this.output.appendLine('Presentation mode stopped. Normal Enter behavior restored.');
  }

  async validate(): Promise<void> {
    const folder = await this.pickFolder(true);
    if (!folder) {
      vscode.window.showErrorMessage(`No ${this.configFile()} found in this workspace.`);
      return;
    }
    const report = await validateProject(folder.uri.fsPath, { configFile: this.configFile() });
    this.output.clear();
    this.output.appendLine(`Validate Presentation · ${folder.name}`);
    this.output.appendLine(`${report.chapters} chapters · ${report.steps} steps · ${report.files.length} declared files`);
    this.output.appendLine(`${report.errors} error(s), ${report.warnings} warning(s)`);
    if (report.finalVerified !== undefined) this.output.appendLine(`Final directory match: ${report.finalVerified ? 'yes' : 'NO'}`);
    if (report.currentCheckpoint !== undefined && report.currentCheckpoint >= 0) {
      this.output.appendLine(`Working directory is at checkpoint ${report.currentCheckpoint}.`);
    }
    for (const item of report.diagnostics) this.output.appendLine(formatDiagnostic(item));
    this.output.show(true);
    const summary = `Validation: ${report.errors} error(s), ${report.warnings} warning(s) · ${report.steps} steps simulated.`;
    if (report.errors > 0) vscode.window.showErrorMessage(summary);
    else if (report.warnings > 0) vscode.window.showWarningMessage(summary);
    else vscode.window.showInformationMessage(summary);
  }

  async previewSteps(): Promise<void> {
    if (!this.project) {
      const folder = await this.pickFolder(true);
      if (folder) {
        const { project } = await loadProject(folder.uri.fsPath, { configFile: this.configFile() });
        if (project?.checkpoints) this.project = project;
      }
    }
    this.refreshPreview();
    await vscode.commands.executeCommand('betterLiveCoding.preview.focus');
  }

  async generateCheckpoints(): Promise<void> {
    const folder = await this.pickFolder(true);
    if (!folder) {
      vscode.window.showErrorMessage(`No ${this.configFile()} found in this workspace.`);
      return;
    }
    const root = folder.uri.fsPath;
    const { project, diagnostics } = await loadProject(root, { configFile: this.configFile() });
    let capture = false;
    if (project && project.initial.source !== 'initialDirectory') {
      const options = project.initial.source === 'snapshot' ? ['Keep Recorded Initial State', 'Re-capture from Working Directory'] : ['Capture Working Directory'];
      const choice = await vscode.window.showInformationMessage(
        project.initial.source === 'snapshot'
          ? 'An initial checkpoint already exists. Keep it, or record the current working directory as the new starting state?'
          : 'Record the current content of the declared files as the initial checkpoint? Make sure they are in their starting state.',
        { modal: true },
        ...options
      );
      if (!choice) return;
      capture = choice !== 'Keep Recorded Initial State';
    } else if (!project) {
      this.logDiagnostics('Generate Checkpoints', diagnostics);
      vscode.window.showErrorMessage('Fix the presentation errors first (see Output › Better Live Coding).');
      this.output.show(true);
      return;
    }
    const result = await generateCheckpointFiles(root, { capture, configFile: this.configFile() });
    this.logDiagnostics('Generate Checkpoints', result.diagnostics);
    if (!result.ok) {
      vscode.window.showErrorMessage('Checkpoints could not be generated; see Output › Better Live Coding.');
      this.output.show(true);
      return;
    }
    vscode.window.showInformationMessage(`Generated ${result.checkpoints} checkpoints (${result.written.join(', ')}).`);
  }

  async generateCandidates(): Promise<void> {
    const folder = await this.pickFolder(false);
    if (!folder) return;
    const pick = async (title: string) =>
      (await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, defaultUri: folder.uri, title, openLabel: 'Select' }))?.[0];
    const start = await pick('Select the START directory');
    if (!start) return;
    const end = await pick('Select the END directory');
    if (!end) return;
    const root = folder.uri.fsPath;
    for (const target of [start, end]) {
      if (path.relative(root, target.fsPath).startsWith('..')) {
        vscode.window.showErrorMessage('Both directories must be inside the workspace folder.');
        return;
      }
    }
    const output = `${CONFIG_DIRECTORY}/candidates.json`;
    const report = await generateCandidateFile(root, path.relative(root, start.fsPath), path.relative(root, end.fsPath), output);
    await vscode.window.showTextDocument(vscode.Uri.file(path.join(root, output)), { preview: false });
    vscode.window.showInformationMessage(
      `${report.groups.length} candidate groups written. They are a draft: decide the semantic steps and teaching order yourself.`
    );
  }

  // ----------------------------------------------------------------- helpers

  private onDocumentChanged(event: vscode.TextDocumentChangeEvent): void {
    if (!this.active || !this.host || !this.session || event.contentChanges.length === 0) return;
    const file = this.host.relative(event.document.uri);
    if (!file || !this.session.checkpoints.files.includes(file)) return;
    if (this.host.suppressor.isOwnChange(file, event.document.version)) return;
    this.session.noteExternalChange(file);
    this.updateStatus(`External edit in ${file} · checkpoint will be checked`);
    this.output.appendLine(`External edit detected in ${file}.`);
  }

  private async setContext(): Promise<void> {
    await vscode.commands.executeCommand('setContext', CONTEXT_ACTIVE, this.active);
    await vscode.commands.executeCommand('setContext', CONTEXT_RUNNING, this.active && !!this.session?.running);
  }

  private updateStatus(detail?: string): void {
    if (!this.active || !this.session) return;
    const steps = this.session.steps;
    const position = statusText(steps, this.session.machine.completedSteps);
    if (detail) this.statusItem.text = `$(record) ${position} · ${detail}`;
    else if (!this.session.nextStep) this.statusItem.text = '$(pass-filled) Live Coding · Complete';
    else this.statusItem.text = `$(debug-step-over) ${position} · Enter`;
    const next = this.session.nextStep;
    this.statusItem.tooltip = next
      ? `Next: ${next.chapter.title} › ${next.step.title}\n${next.step.objective ?? ''}\nEnter runs the next step while an editor is focused.`
      : 'All steps complete.';
    this.statusItem.show();
  }

  private refreshPreview(): void {
    const project = this.project;
    if (!project?.checkpoints) {
      this.preview.update(undefined);
      return;
    }
    const session = this.session;
    const completed = session?.machine.completedSteps ?? 0;
    const state: PreviewState = {
      presentation: project.presentation,
      steps: project.checkpoints.steps,
      completedSteps: completed,
      active: this.active,
      running: !!session?.running,
      paused: !!session?.machine.paused,
      checkpointLabel: this.checkpointLabel(completed)
    };
    this.preview.update(state);
  }

  private checkpointLabel(index: number): string {
    const steps = this.project?.checkpoints?.steps ?? [];
    if (index === 0) return 'Checkpoint 0 · initial state';
    const step = steps[index - 1];
    return step ? `Checkpoint ${index} · after "${step.step.title}"` : `Checkpoint ${index}`;
  }

  private pacing(): PacingSettings {
    const config = vscode.workspace.getConfiguration('betterLiveCoding');
    const keys = [
      'humanMode',
      'fixedTypingDelayMs',
      'fastTypingDelayMinMs',
      'fastTypingDelayMaxMs',
      'slowTypingDelayMinMs',
      'slowTypingDelayMaxMs',
      'punctuationPauseMs',
      'linePauseMs',
      'blankLinePauseMs',
      'blockEndPauseMs',
      'fileSwitchPauseMs',
      'thinkingPauseMs',
      'suggestionVisibleMs',
      'editorEffects'
    ] as const;
    const partial: Partial<PacingSettings> = {};
    for (const key of keys) (partial as Record<string, unknown>)[key] = config.get(key);
    if (this.project?.presentation.humanMode?.enabled === false) partial.humanMode = false;
    return resolvePacing(partial);
  }

  private configFile(): string {
    return vscode.workspace.getConfiguration('betterLiveCoding').get<string>('presentationFile') || CONFIG_FILE;
  }

  private async pickFolder(requireConfig: boolean): Promise<vscode.WorkspaceFolder | undefined> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const candidates: vscode.WorkspaceFolder[] = [];
    for (const folder of folders) {
      if (!requireConfig || (await exists(path.join(folder.uri.fsPath, this.configFile())))) candidates.push(folder);
    }
    if (candidates.length <= 1) return candidates[0];
    return vscode.window.showWorkspaceFolderPick({ placeHolder: 'Choose the workspace folder of the presentation' });
  }

  private sessionStore(root: string): SessionStore {
    const key = `betterLiveCoding.session:${root}`;
    return {
      load: async () => this.context.workspaceState.get<SavedSession>(key),
      save: async (session) => {
        await this.context.workspaceState.update(key, session);
      }
    };
  }

  private async manifestCheckpoint(root: string): Promise<number> {
    if (!this.session) return -1;
    try {
      const manifest = JSON.parse(await fs.readFile(path.join(root, MANIFEST), 'utf8')) as CheckpointManifest;
      if (manifest.presentationHash !== this.session.presentationHash) return -1;
      return identifyByManifest(await this.session.readActual(), manifest);
    } catch {
      return -1;
    }
  }

  private logDiagnostics(title: string, diagnostics: { severity: string }[]): void {
    if (diagnostics.length === 0) return;
    this.output.appendLine(`${title}:`);
    for (const item of diagnostics) this.output.appendLine(`  ${formatDiagnostic(item as never)}`);
  }
}

async function writeIfMissing(file: string, content: string): Promise<void> {
  if (await exists(file)) return;
  await fs.writeFile(file, content, 'utf8');
}
