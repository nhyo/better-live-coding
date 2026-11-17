/**
 * Loads a presentation project from a workspace folder and validates it
 * end-to-end (schema rules, paths, anchors, full dry run, final state).
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { CONFIG_DIRECTORY, CONFIG_FILE, parsePresentation } from '../config/load';
import { Diagnostic, Presentation } from '../config/types';
import {
  CheckpointBuildError,
  CheckpointManifest,
  CheckpointSet,
  InitialSnapshot,
  buildCheckpoints,
  declaredFiles,
  hashPresentation,
  identifyCheckpoint,
  snapshotFromFiles,
  snapshotToFileSet
} from '../checkpoints/checkpoints';
import { exists, readDeclared } from '../checkpoints/fileStore';
import { FileSet } from '../engine/operations';
import { Eol, normalizeEol } from '../utilities/text';

export const CHECKPOINT_DIRECTORY = `${CONFIG_DIRECTORY}/checkpoints`;
export const INITIAL_SNAPSHOT = `${CHECKPOINT_DIRECTORY}/initial.json`;
export const MANIFEST = `${CHECKPOINT_DIRECTORY}/manifest.json`;

export type InitialSource = 'initialDirectory' | 'snapshot' | 'workingDirectory';

export interface Project {
  root: string;
  presentation: Presentation;
  workingDirectory: string;
  workingDirectoryExists: boolean;
  initial: { files: FileSet; eol: Record<string, Eol>; source: InitialSource };
  checkpoints?: CheckpointSet;
}

export interface LoadProjectResult {
  project?: Project;
  diagnostics: Diagnostic[];
}

export async function loadProject(root: string, options: { configFile?: string } = {}): Promise<LoadProjectResult> {
  const diagnostics: Diagnostic[] = [];
  const configPath = path.join(root, options.configFile ?? CONFIG_FILE);
  let source: string;
  try {
    source = await fs.readFile(configPath, 'utf8');
  } catch {
    diagnostics.push({
      severity: 'error',
      message: `No presentation found at ${options.configFile ?? CONFIG_FILE}.`,
      hint: 'Run "Better Live Coding: Initialize Presentation" to create one.'
    });
    return { diagnostics };
  }
  const parsed = parsePresentation(source);
  diagnostics.push(...parsed.diagnostics);
  if (!parsed.presentation) return { diagnostics };
  const presentation = parsed.presentation;
  const workspace = presentation.workspace ?? {};
  const workingDirectory = path.resolve(root, workspace.workingDirectory ?? '.');

  const workingDirectoryExists = await exists(workingDirectory);
  if (!workingDirectoryExists) {
    if (!workspace.initialDirectory) {
      diagnostics.push({
        severity: 'error',
        message: `Working directory "${workspace.workingDirectory}" does not exist.`,
        hint: 'Create it (for example by copying your starter project) or fix workspace.workingDirectory.'
      });
      return { diagnostics };
    }
    diagnostics.push({
      severity: 'warning',
      message: `Working directory "${workspace.workingDirectory}" does not exist yet.`,
      hint: `Start Presentation Mode offers to create it from "${workspace.initialDirectory}".`
    });
  }

  const files = declaredFiles(presentation);
  const workingRelative = path.relative(root, workingDirectory).replace(/\\/g, '/');
  for (const file of files) {
    const fromRoot = workingRelative ? `${workingRelative}/${file}` : file;
    if (fromRoot === CONFIG_DIRECTORY || fromRoot.startsWith(`${CONFIG_DIRECTORY}/`)) {
      diagnostics.push({ severity: 'error', message: `Presentation files may not live inside ${CONFIG_DIRECTORY}: ${file}.`, file });
    }
  }
  if (diagnostics.some((item) => item.severity === 'error')) return { diagnostics };

  let initial: Project['initial'];
  if (workspace.initialDirectory) {
    const base = path.resolve(root, workspace.initialDirectory);
    if (!(await exists(base))) {
      diagnostics.push({ severity: 'error', message: `Initial directory "${workspace.initialDirectory}" does not exist.` });
      return { diagnostics };
    }
    initial = { ...fromRaw(await readDeclared(base, files), files), source: 'initialDirectory' };
  } else if (await exists(path.join(root, INITIAL_SNAPSHOT))) {
    let snapshot: InitialSnapshot;
    try {
      snapshot = JSON.parse(await fs.readFile(path.join(root, INITIAL_SNAPSHOT), 'utf8'));
    } catch (error) {
      diagnostics.push({ severity: 'error', message: `${INITIAL_SNAPSHOT} is not valid JSON: ${(error as Error).message}` });
      return { diagnostics };
    }
    const missing = files.filter((file) => !(file in (snapshot.files ?? {})));
    if (missing.length > 0) {
      diagnostics.push({
        severity: 'error',
        message: `The initial checkpoint does not cover ${missing.join(', ')}.`,
        hint: 'Restore the working directory to its starting state and run "Better Live Coding: Generate Checkpoints".'
      });
      return { diagnostics };
    }
    initial = { ...snapshotToFileSet(snapshot), source: 'snapshot' };
  } else {
    initial = { ...fromRaw(await readDeclared(workingDirectory, files), files), source: 'workingDirectory' };
    diagnostics.push({
      severity: 'warning',
      message: 'No initial checkpoint recorded; the current working directory is treated as the starting state.',
      hint: 'Run "Better Live Coding: Generate Checkpoints" while the files are in their starting state, or set workspace.initialDirectory.'
    });
  }

  const project: Project = { root, presentation, workingDirectory, workingDirectoryExists, initial };
  try {
    project.checkpoints = buildCheckpoints(presentation, initial.files, initial.eol, workspace.newFileEol ?? 'lf');
  } catch (error) {
    if (error instanceof CheckpointBuildError) {
      diagnostics.push({
        severity: 'error',
        message: error.message,
        chapterId: error.step.chapter.id,
        stepId: error.step.step.id,
        file: error.file,
        hint: error.hint
      });
    } else {
      diagnostics.push({ severity: 'error', message: (error as Error).message });
    }
  }
  return { project, diagnostics };
}

function fromRaw(raw: Record<string, string | undefined>, files: string[]): { files: FileSet; eol: Record<string, Eol> } {
  const snapshot = snapshotFromFiles(raw, files);
  return snapshotToFileSet(snapshot);
}

export interface ValidationReport {
  diagnostics: Diagnostic[];
  errors: number;
  warnings: number;
  steps: number;
  chapters: number;
  files: string[];
  currentCheckpoint?: number;
  finalVerified?: boolean;
}

export async function validateProject(root: string, options: { configFile?: string } = {}): Promise<ValidationReport> {
  const { project, diagnostics } = await loadProject(root, options);
  const report = (extra: Partial<ValidationReport> = {}): ValidationReport => ({
    diagnostics,
    errors: diagnostics.filter((item) => item.severity === 'error').length,
    warnings: diagnostics.filter((item) => item.severity === 'warning').length,
    steps: project?.checkpoints?.steps.length ?? 0,
    chapters: project?.presentation.chapters.length ?? 0,
    files: project?.checkpoints?.files ?? [],
    ...extra
  });
  if (!project?.checkpoints) return report();
  const { presentation, checkpoints } = project;

  // Semantic-step hygiene warnings.
  for (const flat of checkpoints.steps) {
    const changing = flat.step.operations.filter((operation) => !['moveCursor', 'selectRange', 'openFile'].includes(operation.type));
    if (changing.length === 0) {
      diagnostics.push({
        severity: 'warning',
        message: `Step "${flat.step.id}" does not change any file.`,
        chapterId: flat.chapter.id,
        stepId: flat.step.id,
        hint: 'Merge it with the step it introduces so each Enter produces a meaningful unit.'
      });
    }
  }

  // Final state.
  let finalVerified: boolean | undefined;
  const finalDirectory = presentation.workspace?.finalDirectory;
  if (finalDirectory) {
    const base = path.resolve(root, finalDirectory);
    if (!(await exists(base))) {
      diagnostics.push({ severity: 'error', message: `Final directory "${finalDirectory}" does not exist.` });
    } else {
      const expected = await readDeclared(base, checkpoints.files);
      const last = checkpoints.states[checkpoints.states.length - 1];
      finalVerified = true;
      for (const file of checkpoints.files) {
        const want = expected[file] === undefined ? null : normalizeEol(expected[file] as string);
        const got = last[file] ?? null;
        if (want !== got) {
          finalVerified = false;
          diagnostics.push({
            severity: 'error',
            message: `Final state of ${file} differs from ${finalDirectory}: ${describeDifference(got, want)}.`,
            file,
            hint: 'Adjust the last steps that edit this file, or update the final directory.'
          });
        }
      }
    }
  }

  // Manifest freshness.
  const manifestPath = path.join(root, MANIFEST);
  if (await exists(manifestPath)) {
    try {
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as CheckpointManifest;
      if (manifest.presentationHash !== hashPresentation(presentation)) {
        diagnostics.push({
          severity: 'warning',
          message: 'Stored checkpoint manifest was generated for a different version of presentation.json.',
          hint: 'Run "Better Live Coding: Generate Checkpoints" again.'
        });
      }
    } catch {
      diagnostics.push({ severity: 'warning', message: `${MANIFEST} could not be read; regenerate checkpoints.` });
    }
  }

  // Where is the working directory right now?
  if (!project.workingDirectoryExists) return report({ finalVerified });
  const raw = await readDeclared(project.workingDirectory, checkpoints.files);
  const actual: FileSet = Object.fromEntries(checkpoints.files.map((file) => [file, raw[file] === undefined ? null : normalizeEol(raw[file] as string)]));
  const currentCheckpoint = identifyCheckpoint(actual, checkpoints);
  if (currentCheckpoint === -1) {
    diagnostics.push({
      severity: 'warning',
      message: 'The working directory does not match any checkpoint right now.',
      hint: 'Start Presentation Mode offers to restore a checkpoint; only declared files are written.'
    });
  }
  return report({ currentCheckpoint, finalVerified });
}

function describeDifference(got: string | null, want: string | null): string {
  if (got === null) return 'the presentation never creates it';
  if (want === null) return 'the file does not exist in the final directory';
  const a = got.split('\n');
  const b = want.split('\n');
  for (let line = 0; line < Math.max(a.length, b.length); line += 1) {
    if (a[line] !== b[line]) {
      return `first difference at line ${line + 1} (generated "${(a[line] ?? '<end of file>').trim().slice(0, 50)}", expected "${(b[line] ?? '<end of file>').trim().slice(0, 50)}")`;
    }
  }
  return 'content differs';
}

export function formatDiagnostic(item: Diagnostic): string {
  const where = [item.chapterId && `chapter ${item.chapterId}`, item.stepId && `step ${item.stepId}`, item.file && `file ${item.file}`, item.location]
    .filter(Boolean)
    .join(' · ');
  return `${item.severity.toUpperCase()}${where ? ` [${where}]` : ''}: ${item.message}${item.hint ? `\n    → ${item.hint}` : ''}`;
}
