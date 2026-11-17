/**
 * Technology-independent checkpoints. Checkpoint 0 is the initial state;
 * checkpoint N is the state after step N. Checkpoints contain only declared
 * files, keyed by working-directory-relative paths (never absolute paths).
 */

import { createHash } from 'node:crypto';
import { FlatStep, Presentation, flattenSteps } from '../config/types';
import { FileSet, StepError, applyStep } from '../engine/operations';
import { Eol, normalizeEol } from '../utilities/text';

export interface CheckpointSet {
  files: string[];
  /** Line ending per declared file, used whenever a checkpoint is written. */
  eol: Record<string, Eol>;
  states: FileSet[];
  steps: FlatStep[];
}

export interface InitialSnapshot {
  version: 1;
  /** Working-directory-relative files. `null` = file absent at the start. */
  files: Record<string, { eol: Eol; text: string } | null>;
}

export interface CheckpointManifest {
  version: 1;
  presentationHash: string;
  checkpoints: { index: number; stepId: string | null; files: Record<string, string | null> }[];
}

/** All files a presentation may touch: every operation target plus workspace.files. */
export function declaredFiles(presentation: Presentation): string[] {
  const files = new Set<string>(presentation.workspace?.files ?? []);
  for (const chapter of presentation.chapters) {
    for (const step of chapter.steps) {
      for (const operation of step.operations) files.add(operation.file.replace(/\\/g, '/'));
    }
  }
  return [...files].sort();
}

export function buildCheckpoints(presentation: Presentation, initial: FileSet, eol: Record<string, Eol>, newFileEol: Eol = 'lf'): CheckpointSet {
  const files = declaredFiles(presentation);
  const start: FileSet = {};
  for (const file of files) start[file] = initial[file] === undefined || initial[file] === null ? null : normalizeEol(initial[file] as string);
  const steps = flattenSteps(presentation);
  const states: FileSet[] = [start];
  for (const flat of steps) {
    try {
      states.push(applyStep(states[states.length - 1], flat.step));
    } catch (error) {
      if (error instanceof StepError) {
        throw new CheckpointBuildError(error.message, flat, error.file, error.hint);
      }
      throw error;
    }
  }
  const eolMap: Record<string, Eol> = {};
  for (const file of files) eolMap[file] = eol[file] ?? newFileEol;
  return { files, eol: eolMap, states, steps };
}

export class CheckpointBuildError extends Error {
  constructor(
    message: string,
    readonly step: FlatStep,
    readonly file?: string,
    readonly hint?: string
  ) {
    super(message);
  }
}

export function sameState(actual: FileSet, expected: FileSet, files: string[]): boolean {
  return files.every((file) => normalizeOrNull(actual[file]) === normalizeOrNull(expected[file]));
}

export function changedFiles(actual: FileSet, expected: FileSet, files: string[]): string[] {
  return files.filter((file) => normalizeOrNull(actual[file]) !== normalizeOrNull(expected[file]));
}

/**
 * Finds the checkpoint matching the actual files. When several checkpoints are
 * identical (e.g. a step that only moves the cursor), the preferred index wins
 * if it matches; otherwise the earliest match is returned. -1 = no match.
 */
export function identifyCheckpoint(actual: FileSet, set: CheckpointSet, preferred?: number): number {
  const matches = set.states.map((state, index) => (sameState(actual, state, set.files) ? index : -1)).filter((index) => index >= 0);
  if (matches.length === 0) return -1;
  if (preferred !== undefined && matches.includes(preferred)) return preferred;
  return matches[0];
}

export function hashText(text: string | null | undefined): string | null {
  if (text === null || text === undefined) return null;
  return createHash('sha256').update(normalizeEol(text), 'utf8').digest('hex');
}

export function hashPresentation(presentation: Presentation): string {
  return createHash('sha256').update(JSON.stringify(presentation), 'utf8').digest('hex').slice(0, 16);
}

export function createManifest(presentation: Presentation, set: CheckpointSet): CheckpointManifest {
  return {
    version: 1,
    presentationHash: hashPresentation(presentation),
    checkpoints: set.states.map((state, index) => ({
      index,
      stepId: index === 0 ? null : set.steps[index - 1].step.id,
      files: Object.fromEntries(set.files.map((file) => [file, hashText(state[file])]))
    }))
  };
}

/** Identify a checkpoint using only stored hashes (crash / reload recovery without rebuilding). */
export function identifyByManifest(actual: FileSet, manifest: CheckpointManifest): number {
  const found = manifest.checkpoints.find((checkpoint) =>
    Object.entries(checkpoint.files).every(([file, hash]) => hashText(actual[file]) === hash)
  );
  return found ? found.index : -1;
}

export function snapshotFromFiles(files: Record<string, string | undefined>, declared: string[]): InitialSnapshot {
  const result: InitialSnapshot = { version: 1, files: {} };
  for (const file of declared) {
    const raw = files[file];
    result.files[file] = raw === undefined ? null : { eol: /\r\n/.test(raw) ? 'crlf' : 'lf', text: normalizeEol(raw) };
  }
  return result;
}

export function snapshotToFileSet(snapshot: InitialSnapshot): { files: FileSet; eol: Record<string, Eol> } {
  const files: FileSet = {};
  const eol: Record<string, Eol> = {};
  for (const [file, entry] of Object.entries(snapshot.files)) {
    files[file] = entry ? normalizeEol(entry.text) : null;
    if (entry) eol[file] = entry.eol;
  }
  return { files, eol };
}

function normalizeOrNull(text: string | null | undefined): string | null {
  return text === null || text === undefined ? null : normalizeEol(text);
}
