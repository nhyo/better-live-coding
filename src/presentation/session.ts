/**
 * Host-independent presentation session: state machine + runner + checkpoints.
 * The VS Code controller only adds dialogs, status bar and keybindings on top.
 */

import { FlatStep, Presentation } from '../config/types';
import {
  CheckpointSet,
  changedFiles,
  hashPresentation,
  identifyCheckpoint,
  sameState
} from '../checkpoints/checkpoints';
import { Clock, EditorHost } from '../engine/host';
import { FileSet } from '../engine/operations';
import { PacingSettings } from '../engine/pacing';
import { RunOutcome, StepRunner } from '../engine/runner';
import { StepStateMachine } from '../engine/stateMachine';
import { applyEol, normalizeEol } from '../utilities/text';

export interface SavedSession {
  presentationHash: string;
  completedSteps: number;
  running: boolean;
  updatedAt: string;
}

export interface SessionStore {
  load(): Promise<SavedSession | undefined>;
  save(session: SavedSession): Promise<void>;
}

export type NextResult =
  | { status: 'ignored'; reason: 'running' | 'inactive' }
  | { status: 'finished' }
  | { status: 'unexpected-changes'; checkpoint: number; files: string[] }
  | { status: RunOutcome; step: FlatStep; checkpoint: number }
  | { status: 'error'; step: FlatStep; checkpoint: number; message: string; files: string[] };

export interface SessionOptions {
  presentation: Presentation;
  checkpoints: CheckpointSet;
  host: EditorHost;
  clock: Clock;
  settings: PacingSettings;
  store?: SessionStore;
  completedSteps?: number;
}

export class PresentationSession {
  readonly machine: StepStateMachine;
  readonly presentationHash: string;
  private currentRun: Promise<NextResult> | undefined;
  private readonly externalChanges = new Set<string>();

  constructor(private readonly options: SessionOptions) {
    this.machine = new StepStateMachine(options.checkpoints.steps.length, options.completedSteps ?? 0);
    this.presentationHash = hashPresentation(options.presentation);
  }

  get checkpoints(): CheckpointSet {
    return this.options.checkpoints;
  }
  get steps(): FlatStep[] {
    return this.options.checkpoints.steps;
  }
  get nextStep(): FlatStep | undefined {
    return this.steps[this.machine.completedSteps];
  }
  get running(): boolean {
    return this.machine.running;
  }
  get externallyChanged(): string[] {
    return [...this.externalChanges];
  }

  async readActual(): Promise<FileSet> {
    const result: FileSet = {};
    for (const file of this.checkpoints.files) {
      const raw = await this.options.host.readFile(file);
      result[file] = raw === undefined ? null : normalizeEol(raw);
    }
    return result;
  }

  /** Identifies the checkpoint that matches the current files (-1 = none). */
  async detectCheckpoint(): Promise<{ index: number; saved?: SavedSession }> {
    const saved = await this.options.store?.load();
    const preferred = saved && saved.presentationHash === this.presentationHash ? saved.completedSteps : undefined;
    const index = identifyCheckpoint(await this.readActual(), this.checkpoints, preferred);
    return { index, saved: saved && saved.presentationHash === this.presentationHash ? saved : undefined };
  }

  /** Files that writing checkpoint `index` would change. */
  async filesChangedBy(index: number): Promise<string[]> {
    return changedFiles(await this.readActual(), this.checkpoints.states[index], this.checkpoints.files);
  }

  /**
   * Runs the next semantic step. A second call while a step runs is ignored
   * synchronously (double Enter protection).
   */
  next(): Promise<NextResult> {
    if (!this.machine.beginNext()) {
      if (this.machine.running) return Promise.resolve({ status: 'ignored', reason: 'running' });
      return Promise.resolve({ status: 'finished' });
    }
    this.currentRun = this.runCurrent().finally(() => {
      this.currentRun = undefined;
    });
    return this.currentRun;
  }

  private async runCurrent(): Promise<NextResult> {
    const index = this.machine.completedSteps;
    const flat = this.steps[index];
    const start = this.checkpoints.states[index];
    const expectedEnd = this.checkpoints.states[index + 1];

    const actual = await this.readActual();
    if (!sameState(actual, start, this.checkpoints.files)) {
      this.machine.cancel();
      return { status: 'unexpected-changes', checkpoint: index, files: changedFiles(actual, start, this.checkpoints.files) };
    }
    this.externalChanges.clear();
    await this.persist(true);

    const runner = new StepRunner(this.options.host, this.options.clock, this.machine, this.options.settings, {
      seed: this.options.presentation.humanMode?.seed ?? this.options.presentation.title,
      newFileEol: this.options.presentation.workspace?.newFileEol ?? 'lf'
    });

    try {
      const { outcome } = await runner.run(flat, start);
      if (outcome === 'aborted') {
        await this.writeCheckpoint(index);
        this.machine.cancel();
        await this.persist(false);
        return { status: 'aborted', step: flat, checkpoint: index };
      }
      if (outcome === 'skipped') {
        await this.writeCheckpoint(index + 1);
      }
      const after = await this.readActual();
      if (!sameState(after, expectedEnd, this.checkpoints.files)) {
        const files = changedFiles(after, expectedEnd, this.checkpoints.files);
        this.machine.cancel();
        await this.persist(false);
        return {
          status: 'error',
          step: flat,
          checkpoint: index,
          message: `Step "${flat.step.id}" did not produce its expected checkpoint (${files.join(', ')}).`,
          files
        };
      }
      this.machine.complete();
      await this.persist(false);
      return { status: outcome, step: flat, checkpoint: this.machine.completedSteps };
    } catch (error) {
      this.machine.cancel();
      await this.persist(false);
      const files = changedFiles(await this.readActual(), start, this.checkpoints.files);
      return { status: 'error', step: flat, checkpoint: index, message: (error as Error).message, files };
    }
  }

  togglePause(): boolean | undefined {
    if (!this.machine.running) return undefined;
    return this.machine.togglePause();
  }

  skip(): boolean {
    return this.machine.requestSkip();
  }

  /** Stops a running step (rolling back to its start checkpoint) and waits for it. */
  async interrupt(reason: string): Promise<void> {
    if (!this.machine.running || !this.currentRun) return;
    this.machine.requestAbort(reason);
    await this.currentRun;
  }

  /** Restarts the current step: rollback to its start checkpoint, then run it again. */
  async restartStep(): Promise<NextResult> {
    await this.interrupt('restart step');
    let index = this.machine.completedSteps;
    if (index >= this.steps.length) index = this.steps.length - 1;
    await this.restore(index);
    return this.next();
  }

  /** Writes checkpoint `index` (declared files only) and moves the state machine there. */
  async restore(index: number): Promise<string[]> {
    if (index < 0 || index >= this.checkpoints.states.length) throw new RangeError(`Checkpoint ${index} does not exist.`);
    await this.interrupt('restore checkpoint');
    const changed = await this.writeCheckpoint(index);
    this.machine.restore(index);
    this.externalChanges.clear();
    await this.persist(false);
    return changed;
  }

  async exit(): Promise<void> {
    await this.interrupt('exit');
    await this.persist(false);
  }

  noteExternalChange(file: string): void {
    if (this.checkpoints.files.includes(file)) this.externalChanges.add(file);
  }

  /** Writes only declared files whose content differs from the checkpoint. */
  async writeCheckpoint(index: number): Promise<string[]> {
    const target = this.checkpoints.states[index];
    const host = this.options.host;
    const changed: string[] = [];
    for (const file of this.checkpoints.files) {
      const desired = target[file];
      const raw = await host.readFile(file);
      if (desired === null || desired === undefined) {
        if (raw !== undefined) {
          await host.deleteFile(file);
          changed.push(file);
        }
        continue;
      }
      if (raw !== undefined && normalizeEol(raw) === desired) continue;
      await host.writeFile(file, applyEol(desired, this.checkpoints.eol[file] ?? 'lf'));
      await host.saveWithoutFormatting(file);
      changed.push(file);
    }
    if (changed.length > 0) host.log(`Checkpoint ${index} written: ${changed.join(', ')}`);
    return changed;
  }

  private async persist(running: boolean): Promise<void> {
    await this.options.store?.save({
      presentationHash: this.presentationHash,
      completedSteps: this.machine.completedSteps,
      running,
      updatedAt: new Date().toISOString()
    });
  }
}
