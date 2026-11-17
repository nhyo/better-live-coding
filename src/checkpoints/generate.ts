/**
 * Writes `.better-live-coding/checkpoints/initial.json` and `manifest.json`.
 * Shared by the VS Code command and the command-line scripts.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createManifest, declaredFiles, snapshotFromFiles } from './checkpoints';
import { listFiles, readDeclared } from './fileStore';
import { CHECKPOINT_DIRECTORY, INITIAL_SNAPSHOT, MANIFEST, loadProject } from '../presentation/project';
import { generateCandidates, CandidateReport } from '../presentation/candidates';
import { FileSet } from '../engine/operations';
import { normalizeEol } from '../utilities/text';
import { Diagnostic } from '../config/types';

export interface GenerateResult {
  ok: boolean;
  diagnostics: Diagnostic[];
  written: string[];
  checkpoints: number;
}

/**
 * @param capture When true (or when no initial checkpoint exists and no
 * initialDirectory is configured) the working directory is recorded as the
 * initial state. Callers must confirm with the user first.
 */
export async function generateCheckpointFiles(root: string, options: { capture?: boolean; configFile?: string } = {}): Promise<GenerateResult> {
  const written: string[] = [];
  if (options.capture) {
    const first = await loadProject(root, options);
    const presentation = first.project?.presentation;
    if (!presentation) return { ok: false, diagnostics: first.diagnostics, written, checkpoints: 0 };
    const files = declaredFiles(presentation);
    const raw = await readDeclared(first.project!.workingDirectory, files);
    const snapshot = snapshotFromFiles(raw, files);
    await fs.mkdir(path.join(root, CHECKPOINT_DIRECTORY), { recursive: true });
    await fs.writeFile(path.join(root, INITIAL_SNAPSHOT), `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
    written.push(INITIAL_SNAPSHOT);
  }
  const { project, diagnostics } = await loadProject(root, options);
  if (!project?.checkpoints) return { ok: false, diagnostics, written, checkpoints: 0 };
  const manifest = createManifest(project.presentation, project.checkpoints);
  await fs.mkdir(path.join(root, CHECKPOINT_DIRECTORY), { recursive: true });
  await fs.writeFile(path.join(root, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  written.push(MANIFEST);
  return { ok: true, diagnostics, written, checkpoints: manifest.checkpoints.length };
}

export async function readDirectoryFileSet(base: string): Promise<FileSet> {
  const files = await listFiles(base);
  const raw = await readDeclared(base, files);
  return Object.fromEntries(files.map((file) => [file, raw[file] === undefined ? null : normalizeEol(raw[file] as string)]));
}

export async function generateCandidateFile(root: string, start: string, end: string, output: string): Promise<CandidateReport> {
  const report = generateCandidates(await readDirectoryFileSet(path.resolve(root, start)), await readDirectoryFileSet(path.resolve(root, end)), {
    start: start.replace(/\\/g, '/'),
    end: end.replace(/\\/g, '/')
  });
  await fs.mkdir(path.dirname(path.resolve(root, output)), { recursive: true });
  await fs.writeFile(path.resolve(root, output), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}
