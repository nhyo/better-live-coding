/**
 * Presentation configuration model (`.better-live-coding/presentation.json`).
 * Mirrors `schemas/presentation.schema.json`.
 */

export const OPERATION_TYPES = [
  'insertBefore',
  'insertAfter',
  'replace',
  'delete',
  'createFile',
  'deleteFile',
  'moveCursor',
  'selectRange',
  'openFile',
  'replaceFile'
] as const;

export type OperationType = (typeof OPERATION_TYPES)[number];

export type Pace = 'fast' | 'slow' | 'auto';
export type ScrollPolicy = 'center' | 'centerIfOutside' | 'top' | 'minimal' | 'none';
export type NewFileEol = 'lf' | 'crlf';

export interface Anchor {
  /** Literal text that must occur exactly once (within `line` when given). */
  text?: string;
  /** Regular expression source that must match exactly once. */
  regex?: string;
  /** Regular expression flags (`i`, `m`, `s`, `u`). `g` and `y` are not allowed. */
  flags?: string;
  /** One-based line. Alone: a position. With text/regex: restricts the search to this line. */
  line?: number;
  /** One-based column. Requires `line`. */
  column?: number;
  /** One-based end line for range anchors (selectRange, replace, delete). */
  endLine?: number;
  /** One-based end column for range anchors. */
  endColumn?: number;
}

export interface EditorEffects {
  /** Trigger IntelliSense after `identifier.` and parameter hints after `identifier(`. Default true. */
  auto?: boolean;
  /** Extra substrings; when typing completes one of them IntelliSense is shown briefly. */
  suggestAfter?: string[];
  /** Extra substrings; when typing completes one of them parameter hints are shown briefly. */
  parameterHintsAfter?: string[];
}

export interface Operation {
  type: OperationType;
  /** Workspace-relative path below `workspace.workingDirectory`. */
  file: string;
  /** Short human label used in status bar and errors. */
  label?: string;
  anchor?: Anchor;
  /** Inserted / replacement / file text. A string array is joined with newlines. */
  text?: string | string[];
  /** Text that must exist in the file before the operation runs. */
  expectBefore?: string;
  /** Text that must exist in the file after the operation runs. */
  expectAfter?: string;
  pace?: Pace;
  /** Shown as `Thinking · …` while the edit location is revealed. */
  thinking?: string;
  effects?: EditorEffects;
  scroll?: ScrollPolicy;
  /** Where the cursor ends for moveCursor (default start). */
  cursor?: 'start' | 'end';
  /** Required for `replaceFile`: declares the operation as an instant, non-animated change. */
  transient?: boolean;
}

export interface Step {
  id: string;
  title: string;
  objective?: string;
  pace?: Pace;
  thinking?: string;
  operations: Operation[];
}

export interface Chapter {
  id: string;
  title: string;
  objective?: string;
  steps: Step[];
}

export interface WorkspaceConfig {
  /** Directory (relative to the workspace folder) where the live coding happens. Default ".". */
  workingDirectory?: string;
  /** Optional pristine copy of the starting files (relative to the workspace folder). */
  initialDirectory?: string;
  /** Optional directory with the expected final files used by validation. */
  finalDirectory?: string;
  /** Extra declared files (relative to the working directory) that are checkpointed even if no step edits them. */
  files?: string[];
  /** Line ending used for files created by the presentation. Default "lf". */
  newFileEol?: NewFileEol;
}

export interface HumanModeConfig {
  enabled?: boolean;
  /** Seed mixed into the deterministic rhythm; change it to get a different (still reproducible) rhythm. */
  seed?: string;
}

export interface Presentation {
  $schema?: string;
  version: 1;
  title: string;
  description?: string;
  workspace?: WorkspaceConfig;
  humanMode?: HumanModeConfig;
  chapters: Chapter[];
}

/** A step flattened with its chapter context. */
export interface FlatStep {
  index: number;
  chapterIndex: number;
  chapter: Chapter;
  stepIndexInChapter: number;
  stepsInChapter: number;
  step: Step;
}

export interface Diagnostic {
  severity: 'error' | 'warning';
  message: string;
  /** JSON-pointer-like location, e.g. `chapters[1].steps[0].operations[2]`. */
  location?: string;
  chapterId?: string;
  stepId?: string;
  file?: string;
  hint?: string;
}

export function flattenSteps(presentation: Presentation): FlatStep[] {
  const result: FlatStep[] = [];
  presentation.chapters.forEach((chapter, chapterIndex) => {
    chapter.steps.forEach((step, stepIndexInChapter) => {
      result.push({
        index: result.length,
        chapterIndex,
        chapter,
        stepIndexInChapter,
        stepsInChapter: chapter.steps.length,
        step
      });
    });
  });
  return result;
}

export function operationText(operation: Operation): string {
  const text = operation.text ?? '';
  return Array.isArray(text) ? text.join('\n') : text;
}

export function operationLabel(operation: Operation, index: number): string {
  return operation.label ?? `${operation.type} ${operation.file} #${index + 1}`;
}
