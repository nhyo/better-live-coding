/**
 * Animates one semantic step on an EditorHost.
 *
 * Every operation is planned on the simulated (expected) file set first. Before
 * the first character is typed in a file, the real document is compared with
 * the expected text, so the runner never writes into a document that drifted.
 */

import { FlatStep, Operation, operationLabel } from '../config/types';
import { Eol, Position, applyEol, eolString, normalizeEol, offsetToPosition } from '../utilities/text';
import { Clock, EditorHost } from './host';
import { FileSet, OperationPlan, applyPlan, planOperation } from './operations';
import {
  PacingSettings,
  ResolvedPace,
  characterDelay,
  fileSwitchPause,
  operationEndPause,
  resolvePace,
  thinkingPause
} from './pacing';
import { StepStateMachine } from './stateMachine';

export type RunOutcome = 'completed' | 'skipped' | 'aborted';

export class Interrupted extends Error {
  constructor(readonly kind: 'skip' | 'abort') {
    super(kind === 'skip' ? 'Animation skipped.' : 'Run aborted.');
  }
}

export class DriftError extends Error {
  constructor(readonly file: string) {
    super(`${file} was modified outside the presentation while the step was running.`);
  }
}

export interface RunnerOptions {
  seed: string;
  newFileEol: Eol;
  /** Maximum single sleep slice; pause/skip/abort are checked between slices. */
  sliceMs?: number;
}

export class StepRunner {
  private readonly slice: number;

  constructor(
    private readonly host: EditorHost,
    private readonly clock: Clock,
    private readonly machine: StepStateMachine,
    private readonly settings: PacingSettings,
    private readonly options: RunnerOptions
  ) {
    this.slice = options.sliceMs ?? 50;
  }

  /** Animates the step. Returns how it ended; throws on anchor errors or drift. */
  async run(flat: FlatStep, startFiles: FileSet): Promise<{ outcome: RunOutcome; expected: FileSet }> {
    let files = startFiles;
    const { step } = flat;
    try {
      for (let index = 0; index < step.operations.length; index += 1) {
        await this.gate();
        const operation = step.operations[index];
        const plan = planOperation(files, operation, index);
        await this.animate(flat, operation, index, plan);
        files = applyPlan(files, plan);
      }
      await this.host.hideWidgets();
      return { outcome: 'completed', expected: files };
    } catch (error) {
      await this.host.hideWidgets().catch(() => undefined);
      if (error instanceof Interrupted) return { outcome: error.kind === 'skip' ? 'skipped' : 'aborted', expected: files };
      throw error;
    }
  }

  private async animate(flat: FlatStep, operation: Operation, index: number, plan: OperationPlan): Promise<void> {
    const pace = resolvePace(operation, flat.step);
    const label = operationLabel(operation, index);
    const scroll = operation.scroll ?? 'centerIfOutside';
    const thinking = operation.thinking ?? flat.step.thinking ?? flat.step.title;
    const file = operation.file;

    if (plan.kind === 'createFile') {
      await this.switchTo(file, true);
      await this.verify(file, '');
      const origin = { line: 0, character: 0 };
      await this.host.setSelection(file, origin, origin, scroll);
      await this.think(thinking, pace);
      await this.type(flat, operation, index, pace, origin, plan.insertText);
      await this.finishOperation(file, pace);
      return;
    }

    await this.switchTo(file, false);
    await this.verify(file, plan.before);

    switch (plan.kind) {
      case 'deleteFile': {
        this.host.status(`Removing · ${file}`);
        await this.think(thinking, pace);
        await this.gate();
        await this.host.deleteFile(file);
        await this.wait(operationEndPause(this.settings, pace));
        return;
      }
      case 'replaceFile': {
        this.host.status(`Replacing · ${file}`);
        await this.gate();
        await this.host.writeFile(file, applyEol(plan.after, this.host.eolOf(file)));
        await this.host.saveWithoutFormatting(file);
        return;
      }
      case 'open':
      case 'cursor': {
        if (plan.start !== undefined && plan.end !== undefined) {
          const start = offsetToPosition(plan.before, plan.start);
          const end = offsetToPosition(plan.before, plan.end);
          await this.host.setSelection(file, start, end, scroll);
        }
        await this.think(thinking, pace);
        return;
      }
      case 'edit': {
        const start = offsetToPosition(plan.before, plan.deleteStart);
        const end = offsetToPosition(plan.before, plan.deleteEnd);
        if (plan.showSelection) await this.host.setSelection(file, start, end, scroll);
        else await this.host.setSelection(file, start, start, scroll);
        this.host.status(`Thinking · ${thinking}`);
        await this.think(thinking, pace);
        if (plan.deleteEnd > plan.deleteStart) {
          await this.gate();
          await this.host.delete(file, start, end);
          await this.host.setSelection(file, start, start, scroll);
        }
        this.host.status(label);
        await this.type(flat, operation, index, pace, start, plan.insertText);
        await this.finishOperation(file, pace);
        return;
      }
    }
  }

  private async switchTo(file: string, create: boolean): Promise<void> {
    if (this.host.activeFile() === file && !create) return;
    this.host.status(`Switching file · ${file.split('/').pop()}`);
    await this.gate();
    await this.host.openFile(file, create ? { create: true, eol: this.options.newFileEol } : undefined);
    await this.wait(fileSwitchPause(this.settings));
  }

  private async verify(file: string, expected: string): Promise<void> {
    const raw = await this.host.readFile(file);
    if (raw === undefined || normalizeEol(raw) !== expected) throw new DriftError(file);
  }

  private async think(thinking: string, pace: ResolvedPace): Promise<void> {
    this.host.status(`Thinking · ${thinking}`);
    await this.wait(thinkingPause(this.settings, pace));
  }

  private async type(
    flat: FlatStep,
    operation: Operation,
    operationIndex: number,
    pace: ResolvedPace,
    start: Position,
    text: string
  ): Promise<void> {
    const file = operation.file;
    const eol = eolString(this.host.eolOf(file));
    const characters = [...text];
    const effects = operation.effects ?? {};
    const autoEffects = this.settings.editorEffects && effects.auto !== false;
    let typed = '';
    let cursor = start;
    for (let index = 0; index < characters.length; index += 1) {
      await this.gate();
      const character = characters[index];
      await this.host.insert(file, cursor, character === '\n' ? eol : character);
      cursor = character === '\n' ? { line: cursor.line + 1, character: 0 } : { line: cursor.line, character: cursor.character + character.length };
      typed += character;
      await this.host.setSelection(file, cursor, cursor, operation.scroll ?? 'centerIfOutside');
      await this.wait(
        characterDelay(this.settings, {
          seed: this.options.seed,
          stepId: flat.step.id,
          operationIndex,
          index,
          character,
          previous: characters[index - 1],
          next: characters[index + 1],
          pace
        })
      );
      if (this.settings.editorEffects) {
        const previous = characters[index - 1] ?? '';
        const suggest =
          (autoEffects && character === '.' && /[\w$)\]]/.test(previous) && /[\w$]/.test(characters[index + 1] ?? '')) ||
          (effects.suggestAfter ?? []).some((item) => typed.endsWith(item));
        const hints =
          (autoEffects && character === '(' && /[\w$]/.test(previous)) || (effects.parameterHintsAfter ?? []).some((item) => typed.endsWith(item));
        if (suggest || hints) {
          if (suggest) await this.host.triggerSuggest();
          else await this.host.triggerParameterHints();
          const visible = this.settings.humanMode
            ? pace === 'slow'
              ? this.settings.suggestionVisibleMs
              : Math.min(240, this.settings.suggestionVisibleMs)
            : Math.min(150, this.settings.suggestionVisibleMs);
          await this.wait(visible);
          await this.host.hideWidgets();
        }
      }
    }
  }

  private async finishOperation(file: string, pace: ResolvedPace): Promise<void> {
    await this.host.hideWidgets();
    await this.host.saveWithoutFormatting(file);
    await this.wait(operationEndPause(this.settings, pace));
  }

  /** Blocks while paused; throws when a skip or abort was requested. */
  private async gate(): Promise<void> {
    let hidden = false;
    for (;;) {
      if (this.machine.abortReason) throw new Interrupted('abort');
      if (this.machine.skipRequested) throw new Interrupted('skip');
      if (!this.machine.paused) return;
      if (!hidden) {
        hidden = true;
        await this.host.hideWidgets();
        this.host.status('Paused · press Pause again to resume');
      }
      await this.clock.sleep(this.slice);
    }
  }

  private async wait(milliseconds: number): Promise<void> {
    let remaining = Math.max(0, Math.round(milliseconds));
    while (remaining > 0) {
      await this.gate();
      const slice = Math.min(this.slice, remaining);
      await this.clock.sleep(slice);
      remaining -= slice;
    }
    await this.gate();
  }
}
