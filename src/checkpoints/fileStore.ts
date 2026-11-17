/**
 * Node filesystem access restricted to declared files inside a base directory.
 * Used by validation, checkpoint generation, the CLI scripts and the extension
 * for files that are not open in an editor.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { isInside, isSensitivePath, normalizeRelativePath } from '../utilities/paths';

export class UnsafePathError extends Error {}

/** Resolves a relative path below `base`, refusing escapes (including through symlinks). */
export async function resolveInside(base: string, relative: string): Promise<string> {
  const normalized = normalizeRelativePath(relative);
  if (isSensitivePath(normalized)) throw new UnsafePathError(`Refusing to access sensitive path ${normalized}.`);
  const absolute = path.resolve(base, normalized);
  if (!isInside(path.resolve(base), absolute)) throw new UnsafePathError(`${relative} escapes ${base}.`);
  // If the file (or its nearest existing parent) is a symlink pointing outside, refuse.
  let probe = absolute;
  for (;;) {
    try {
      const real = await fs.realpath(probe);
      const realBase = await fs.realpath(base).catch(() => path.resolve(base));
      if (!isInside(realBase, real)) throw new UnsafePathError(`${relative} resolves outside ${base} through a link.`);
      break;
    } catch (error) {
      if (error instanceof UnsafePathError) throw error;
      const parent = path.dirname(probe);
      if (parent === probe || !isInside(path.resolve(base), parent)) break;
      probe = parent;
    }
  }
  return absolute;
}

export async function readDeclared(base: string, files: string[]): Promise<Record<string, string | undefined>> {
  const result: Record<string, string | undefined> = {};
  for (const file of files) {
    const absolute = await resolveInside(base, file);
    try {
      result[file] = await fs.readFile(absolute, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') result[file] = undefined;
      else throw error;
    }
  }
  return result;
}

export async function writeDeclared(base: string, file: string, text: string): Promise<void> {
  const absolute = await resolveInside(base, file);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, text, 'utf8');
}

export async function deleteDeclared(base: string, file: string): Promise<void> {
  const absolute = await resolveInside(base, file);
  await fs.rm(absolute, { force: true });
}

export async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Lists files below a directory as relative forward-slash paths, skipping
 * sensitive paths (env files, credentials, dependency and VCS folders).
 */
export async function listFiles(base: string, relative = ''): Promise<string[]> {
  const result: string[] = [];
  const folder = path.join(base, relative);
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(folder, { withFileTypes: true });
  } catch {
    return result;
  }
  for (const entry of entries) {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (isSensitivePath(child)) continue;
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) result.push(...(await listFiles(base, child)));
    else if (entry.isFile()) result.push(child);
  }
  return result.sort();
}

/**
 * Copies a directory tree, skipping sensitive paths (env files, credentials,
 * dependency and VCS folders) and symbolic links. Never overwrites existing files.
 */
export async function copyTree(from: string, to: string): Promise<string[]> {
  const copied: string[] = [];
  for (const file of await listFiles(from)) {
    const target = await resolveInside(to, file);
    if (await exists(target)) continue;
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(await resolveInside(from, file), target);
    copied.push(file);
  }
  return copied;
}
