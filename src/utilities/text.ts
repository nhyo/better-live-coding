/**
 * Text helpers shared by the engine, checkpoints and the VS Code adapter.
 *
 * All engine computations run on LF-normalized text. Positions handed to an
 * editor are always expressed as zero-based line/character pairs, which are
 * identical for LF and CRLF documents. Never use an offset computed on
 * normalized text as an offset into a CRLF document.
 */

export type Eol = 'lf' | 'crlf';

export interface Position {
  /** Zero-based line. */
  line: number;
  /** Zero-based UTF-16 character within the line. */
  character: number;
}

export interface Range {
  start: Position;
  end: Position;
}

export function normalizeEol(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

/** Detects the dominant line ending of a document. Defaults to LF. */
export function detectEol(text: string, fallback: Eol = 'lf'): Eol {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/\n/g) ?? []).length - crlf;
  if (crlf === 0 && lf === 0) return fallback;
  return crlf > lf ? 'crlf' : 'lf';
}

export function eolString(eol: Eol): string {
  return eol === 'crlf' ? '\r\n' : '\n';
}

/** Converts LF-normalized text to the requested line ending. */
export function applyEol(normalized: string, eol: Eol): string {
  const lf = normalizeEol(normalized);
  return eol === 'crlf' ? lf.replace(/\n/g, '\r\n') : lf;
}

/** Converts an offset in LF-normalized text to a line/character position. */
export function offsetToPosition(normalized: string, offset: number): Position {
  if (offset < 0 || offset > normalized.length) {
    throw new RangeError(`Offset ${offset} is outside the document (length ${normalized.length}).`);
  }
  let line = 0;
  let lineStart = 0;
  for (let index = normalized.indexOf('\n'); index !== -1 && index < offset; index = normalized.indexOf('\n', index + 1)) {
    line += 1;
    lineStart = index + 1;
  }
  return { line, character: offset - lineStart };
}

/** Converts a line/character position to an offset in LF-normalized text. */
export function positionToOffset(normalized: string, position: Position): number {
  if (position.line < 0 || position.character < 0) {
    throw new RangeError(`Invalid position ${position.line}:${position.character}.`);
  }
  let offset = 0;
  for (let line = 0; line < position.line; line += 1) {
    const next = normalized.indexOf('\n', offset);
    if (next === -1) {
      throw new RangeError(`Line ${position.line + 1} does not exist (document has ${line + 1} lines).`);
    }
    offset = next + 1;
  }
  const lineEnd = normalized.indexOf('\n', offset);
  const lineLength = (lineEnd === -1 ? normalized.length : lineEnd) - offset;
  if (position.character > lineLength) {
    throw new RangeError(
      `Column ${position.character + 1} is beyond the end of line ${position.line + 1} (length ${lineLength}).`
    );
  }
  return offset + position.character;
}

/** Position after inserting `text` (LF-normalized) at `start`. */
export function advancePosition(start: Position, text: string): Position {
  const lines = text.split('\n');
  if (lines.length === 1) return { line: start.line, character: start.character + text.length };
  return { line: start.line + lines.length - 1, character: lines[lines.length - 1].length };
}

/**
 * Deterministic pseudo-random integer in [minimum, maximum] derived from a key
 * (FNV-1a). The same key always yields the same value, which keeps rehearsals
 * reproducible.
 */
export function deterministicRange(key: string, minimum: number, maximum: number): number {
  const low = Math.min(minimum, maximum);
  const high = Math.max(minimum, maximum);
  let hash = 2166136261;
  for (const character of key) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  // Final avalanche so neighbouring keys spread across the range.
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0x5bd1e995);
  hash ^= hash >>> 15;
  const unit = (hash >>> 0) / 0xffffffff;
  return Math.round(low + unit * (high - low));
}

export function countOccurrences(haystack: string, needle: string): number[] {
  const found: number[] = [];
  if (needle.length === 0) return found;
  for (let index = haystack.indexOf(needle); index !== -1; index = haystack.indexOf(needle, index + 1)) {
    found.push(index);
  }
  return found;
}

/** Short single-line preview of a snippet for error messages. */
export function preview(text: string, maximum = 60): string {
  const flat = normalizeEol(text).replace(/\n/g, '⏎');
  return flat.length > maximum ? `${flat.slice(0, maximum - 1)}…` : flat;
}
