/**
 * Anchor resolution. An anchor resolves to exactly one range of LF-normalized
 * text. Missing or ambiguous anchors are hard errors: the engine never guesses
 * a location.
 */

import { Anchor } from '../config/types';
import { countOccurrences, positionToOffset, preview } from '../utilities/text';

export class AnchorError extends Error {
  constructor(message: string, readonly hint?: string) {
    super(message);
  }
}

export interface ResolvedRange {
  /** Offset in LF-normalized text. */
  start: number;
  end: number;
}

export function resolveAnchor(normalized: string, anchor: Anchor, description: string): ResolvedRange {
  const hasLine = anchor.line !== undefined;
  // Restrict the search area to one line when both a pattern and a line are given.
  let areaStart = 0;
  let areaEnd = normalized.length;
  if (hasLine && (anchor.text !== undefined || anchor.regex !== undefined)) {
    areaStart = lineStartOffset(normalized, anchor.line! - 1, description);
    const next = normalized.indexOf('\n', areaStart);
    areaEnd = next === -1 ? normalized.length : next;
    if (anchor.column !== undefined) {
      areaStart = positionToOffsetChecked(normalized, anchor.line! - 1, anchor.column - 1, description);
    }
  }
  const area = normalized.slice(areaStart, areaEnd);

  if (anchor.text !== undefined) {
    const needle = anchor.text.replace(/\r\n?/g, '\n');
    const matches = countOccurrences(area, needle);
    const where = hasLine ? ` on line ${anchor.line}` : '';
    if (matches.length === 0) {
      throw new AnchorError(
        `Anchor not found for ${description}${where}: "${preview(needle)}".`,
        'The file does not contain this text at this point of the presentation. Check earlier steps, whitespace and indentation.'
      );
    }
    if (matches.length > 1) {
      throw new AnchorError(
        `Anchor is not unique for ${description}${where}: "${preview(needle)}" occurs ${matches.length} times.`,
        'Extend the anchor text with neighbouring code, or add "line" to the anchor.'
      );
    }
    return { start: areaStart + matches[0], end: areaStart + matches[0] + needle.length };
  }

  if (anchor.regex !== undefined) {
    const expression = new RegExp(anchor.regex, `${anchor.flags ?? ''}g`);
    const matches = [...area.matchAll(expression)].filter((match) => match[0].length > 0);
    if (matches.length === 0) {
      throw new AnchorError(`Regex anchor /${anchor.regex}/ did not match for ${description}.`, 'Check the expression against the file at this step.');
    }
    if (matches.length > 1) {
      throw new AnchorError(
        `Regex anchor /${anchor.regex}/ matched ${matches.length} times for ${description}.`,
        'Make the expression more specific so it matches exactly once.'
      );
    }
    const start = areaStart + (matches[0].index ?? 0);
    return { start, end: start + matches[0][0].length };
  }

  if (hasLine) {
    const start = positionToOffsetChecked(normalized, anchor.line! - 1, (anchor.column ?? 1) - 1, description);
    if (anchor.endLine !== undefined) {
      const end = positionToOffsetChecked(normalized, anchor.endLine - 1, (anchor.endColumn ?? 1) - 1, description);
      if (end < start) throw new AnchorError(`Anchor range for ${description} ends before it starts.`);
      return { start, end };
    }
    return { start, end: start };
  }

  throw new AnchorError(`Anchor for ${description} has neither text, regex nor line.`);
}

function lineStartOffset(normalized: string, line: number, description: string): number {
  return positionToOffsetChecked(normalized, line, 0, description);
}

function positionToOffsetChecked(normalized: string, line: number, character: number, description: string): number {
  try {
    return positionToOffset(normalized, { line, character });
  } catch (error) {
    throw new AnchorError(`Invalid anchor position for ${description}: ${(error as Error).message}`);
  }
}
