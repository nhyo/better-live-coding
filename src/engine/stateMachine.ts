/**
 * Step state machine. `beginNext` is synchronous so that a second Enter press
 * arriving while a step is starting is rejected before any await happens.
 */

export type RunPhase = 'idle' | 'running' | 'paused';

export class StepStateMachine {
  private phaseValue: RunPhase = 'idle';
  private completed: number;
  private skip = false;
  private abort: string | undefined;

  constructor(
    readonly stepCount: number,
    completedSteps = 0
  ) {
    if (!Number.isInteger(completedSteps) || completedSteps < 0 || completedSteps > stepCount) {
      throw new RangeError(`Invalid checkpoint ${completedSteps}.`);
    }
    this.completed = completedSteps;
  }

  get phase(): RunPhase {
    return this.phaseValue;
  }
  get completedSteps(): number {
    return this.completed;
  }
  get running(): boolean {
    return this.phaseValue !== 'idle';
  }
  get paused(): boolean {
    return this.phaseValue === 'paused';
  }
  get finished(): boolean {
    return this.completed >= this.stepCount;
  }
  get skipRequested(): boolean {
    return this.skip;
  }
  get abortReason(): string | undefined {
    return this.abort;
  }
  /** Index of the step that runs on the next Enter (or is running now). */
  get currentStepIndex(): number {
    return this.completed;
  }

  /** Returns false (and changes nothing) when a step is already running or all steps are done. */
  beginNext(): boolean {
    if (this.running || this.finished) return false;
    this.phaseValue = 'running';
    this.skip = false;
    this.abort = undefined;
    return true;
  }

  complete(): void {
    if (!this.running) throw new Error('No step is running.');
    this.completed += 1;
    this.reset();
  }

  /** Ends a run without advancing (rollback, error or abort). */
  cancel(): void {
    this.reset();
  }

  togglePause(): boolean {
    if (!this.running) return false;
    this.phaseValue = this.phaseValue === 'paused' ? 'running' : 'paused';
    return this.phaseValue === 'paused';
  }

  requestSkip(): boolean {
    if (!this.running) return false;
    this.skip = true;
    if (this.phaseValue === 'paused') this.phaseValue = 'running';
    return true;
  }

  requestAbort(reason: string): boolean {
    if (!this.running) return false;
    this.abort = reason;
    if (this.phaseValue === 'paused') this.phaseValue = 'running';
    return true;
  }

  restore(completedSteps: number): void {
    if (this.running) throw new Error('Cannot restore while a step is running.');
    if (!Number.isInteger(completedSteps) || completedSteps < 0 || completedSteps > this.stepCount) {
      throw new RangeError(`Invalid checkpoint ${completedSteps}.`);
    }
    this.completed = completedSteps;
  }

  private reset(): void {
    this.phaseValue = 'idle';
    this.skip = false;
    this.abort = undefined;
  }
}
