/**
 * Candidate operation generator. Compares a start and an end directory and
 * proposes operations that turn one into the other.
 *
 * The output is deliberately a *draft*: mechanical diffs know nothing about
 * teaching order. Candidates are grouped by heuristic category and file, never
 * split into one step per changed line, and must be reviewed by a human before
 * they become semantic steps in presentation.json.
 */

import { Operation } from '../config/types';
import { classifyText } from '../engine/pacing';
import { FileSet, applyOperation } from '../engine/operations';
import { countOccurrences, normalizeEol } from '../utilities/text';

export type CandidateCategory = 'import' | 'endpoint' | 'function' | 'markup-state-style' | 'removal' | 'file';

export interface CandidateOperation {
  category: CandidateCategory;
  operation: Operation;
}

export interface CandidateGroup {
  id: string;
  title: string;
  category: CandidateCategory;
  files: string[];
  operations: Operation[];
}

export interface CandidateReport {
  note: string;
  generatedFrom: { start: string; end: string };
  groups: CandidateGroup[];
}

interface Hunk {
  /** Line indexes in the old file [oldStart, oldEnd). */
  oldStart: number;
  oldEnd: number;
  newLines: string[];
}

/** Line-level LCS diff. Falls back to one whole-file hunk for very large inputs. */
export function diffLines(oldText: string, newText: string): Hunk[] {
  const a = oldText.split('\n');
  const b = newText.split('\n');
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix += 1;
  const aMid = a.slice(prefix, a.length - suffix);
  const bMid = b.slice(prefix, b.length - suffix);
  if (aMid.length === 0 && bMid.length === 0) return [];
  if (aMid.length * bMid.length > 4_000_000) {
    return [{ oldStart: prefix, oldEnd: prefix + aMid.length, newLines: bMid }];
  }
  const n = aMid.length;
  const m = bMid.length;
  const table: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i][j] = aMid[i] === bMid[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const hunks: Hunk[] = [];
  let i = 0;
  let j = 0;
  let current: Hunk | undefined;
  const flush = () => {
    if (current) hunks.push(current);
    current = undefined;
  };
  while (i < n || j < m) {
    if (i < n && j < m && aMid[i] === bMid[j]) {
      flush();
      i += 1;
      j += 1;
    } else if (j < m && (i >= n || table[i][j + 1] >= table[i + 1][j])) {
      current ??= { oldStart: prefix + i, oldEnd: prefix + i, newLines: [] };
      current.newLines.push(bMid[j]);
      j += 1;
    } else {
      current ??= { oldStart: prefix + i, oldEnd: prefix + i, newLines: [] };
      current.oldEnd = prefix + i + 1;
      i += 1;
    }
  }
  flush();
  return hunks;
}

/** Proposes anchored operations for one file. Applied in order they reproduce `newText`. */
export function candidateOperationsForFile(file: string, oldText: string, newText: string): CandidateOperation[] {
  const result: CandidateOperation[] = [];
  let working = normalizeEol(oldText);
  const target = normalizeEol(newText);
  let delta = 0;
  for (const hunk of diffLines(working, target)) {
    const lines = working.split('\n');
    const ls = hunk.oldStart + delta;
    const le = hunk.oldEnd + delta;
    const offset = (line: number) => lines.slice(0, line).reduce((total, text) => total + text.length + 1, 0);
    let coreStart: number;
    let coreEnd: number;
    let replacement: string;
    if (le < lines.length) {
      coreStart = offset(ls);
      coreEnd = offset(le);
      replacement = hunk.newLines.map((line) => `${line}\n`).join('');
    } else if (ls < lines.length) {
      // The hunk reaches the last line, which has no trailing newline.
      coreStart = ls > 0 ? offset(ls) - 1 : 0;
      coreEnd = working.length;
      replacement = hunk.newLines.length === 0 ? '' : (ls > 0 ? '\n' : '') + hunk.newLines.join('\n');
    } else {
      coreStart = working.length;
      coreEnd = working.length;
      replacement = `\n${hunk.newLines.join('\n')}`;
    }
    const removed = working.slice(coreStart, coreEnd);
    const region = uniqueRegion(working, coreStart, coreEnd);
    const anchor = working.slice(region.from, region.to);
    const prefix = working.slice(region.from, coreStart);
    const suffix = working.slice(coreEnd, region.to);
    let operation: Operation;
    if (anchor === '') {
      operation = { type: 'insertBefore', file, anchor: { line: 1, column: 1 }, text: replacement.replace(/^\n/, ''), label: `add ${describe(replacement)}` };
    } else if (region.from === coreStart && region.to === coreEnd) {
      operation =
        replacement === ''
          ? { type: 'delete', file, anchor: { text: anchor }, label: `remove ${describe(removed)}` }
          : { type: 'replace', file, anchor: { text: anchor }, text: replacement, label: `rewrite ${describe(removed)}` };
    } else if (coreStart === coreEnd && region.from === coreStart) {
      operation = { type: 'insertBefore', file, anchor: { text: anchor }, text: replacement, label: `add ${describe(replacement)}` };
    } else if (coreStart === coreEnd && region.to === coreEnd) {
      operation = { type: 'insertAfter', file, anchor: { text: anchor }, text: replacement, label: `add ${describe(replacement)}` };
    } else {
      operation = {
        type: 'replace',
        file,
        anchor: { text: anchor },
        text: prefix + replacement + suffix,
        label: `${replacement === '' ? 'remove' : removed === '' ? 'add' : 'rewrite'} ${describe(replacement || removed)}`
      };
    }
    const category: CandidateCategory = replacement === '' ? 'removal' : classifyText(replacement).reason;
    working = applyOperation({ [file]: working }, operation)[file] as string;
    delta += hunk.newLines.length - (hunk.oldEnd - hunk.oldStart);
    result.push({ category, operation });
  }
  if (working !== target) {
    // Safety net: never emit a candidate set that does not reproduce the target.
    return [
      {
        category: 'file',
        operation: { type: 'replaceFile', file, transient: true, text: target, label: `replace ${file} (review: diff could not be anchored)` }
      }
    ];
  }
  return result;
}

/**
 * Grows [start, end) by whole neighbouring lines until the text is non-empty
 * and occurs exactly once in the document.
 */
function uniqueRegion(text: string, start: number, end: number): { from: number; to: number } {
  let from = start;
  let to = end;
  const unique = () => to > from && countOccurrences(text, text.slice(from, to)).length === 1;
  const previousLineStart = (position: number) => (position <= 0 ? 0 : text.lastIndexOf('\n', position - 2) + 1);
  const nextLineEnd = (position: number) => {
    if (position >= text.length) return text.length;
    const lineBreak = text.indexOf('\n', position);
    return lineBreak === -1 ? text.length : lineBreak + 1;
  };
  if (from === to) {
    // Pure insertion: prefer anchoring on the following line, then on the previous one.
    if (to < text.length) {
      to = nextLineEnd(to);
      if (unique()) return { from, to };
      to = end;
    }
    if (from > 0) {
      from = previousLineStart(from);
      if (unique()) return { from, to };
    }
    from = start;
    to = end;
  }
  while (!unique()) {
    if (from === 0 && to === text.length) break;
    from = previousLineStart(from);
    to = nextLineEnd(to);
  }
  return { from, to };
}

function describe(text: string): string {
  const line = text.split('\n').map((value) => value.trim()).find(Boolean) ?? 'blank lines';
  return line.length > 40 ? `${line.slice(0, 39)}…` : line;
}

/** Builds a reviewable candidate report for a whole directory pair. */
export function generateCandidates(start: FileSet, end: FileSet, labels: { start: string; end: string }): CandidateReport {
  const files = [...new Set([...Object.keys(start), ...Object.keys(end)])].sort();
  const all: CandidateOperation[] = [];
  for (const file of files) {
    const before = start[file] ?? null;
    const after = end[file] ?? null;
    if (before === after) continue;
    if (before === null && after !== null) {
      all.push({ category: 'file', operation: { type: 'createFile', file, text: after, label: `create ${file}` } });
    } else if (before !== null && after === null) {
      all.push({ category: 'file', operation: { type: 'deleteFile', file, label: `delete ${file}` } });
    } else {
      all.push(...candidateOperationsForFile(file, before as string, after as string));
    }
  }
  const order: CandidateCategory[] = ['file', 'markup-state-style', 'function', 'import', 'endpoint', 'removal'];
  const groups: CandidateGroup[] = [];
  for (const category of order) {
    const byFile = new Map<string, Operation[]>();
    for (const item of all.filter((candidate) => candidate.category === category)) {
      byFile.set(item.operation.file, [...(byFile.get(item.operation.file) ?? []), item.operation]);
    }
    for (const [file, operations] of byFile) {
      groups.push({
        id: `candidate-${groups.length + 1}`,
        title: `${category} changes in ${file}`,
        category,
        files: [file],
        operations
      });
    }
  }
  return {
    note:
      'DRAFT. These operations come from a mechanical diff. They are NOT steps. Reorder and merge them into semantic steps (a state group, a UI block, a function, an endpoint) and choose the teaching order yourself before copying them into presentation.json. Operations inside one file must keep their relative order unless you re-anchor them.',
    generatedFrom: labels,
    groups
  };
}
