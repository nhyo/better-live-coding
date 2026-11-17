/**
 * Parses and structurally validates a presentation file. This validator has no
 * runtime dependencies and mirrors `schemas/presentation.schema.json`; the test
 * suite checks that both agree on every example and fixture.
 */

import { PathError, isSensitivePath, normalizeRelativePath } from '../utilities/paths';
import {
  Anchor,
  Diagnostic,
  OPERATION_TYPES,
  OperationType,
  Presentation
} from './types';

export const CONFIG_DIRECTORY = '.better-live-coding';
export const CONFIG_FILE = `${CONFIG_DIRECTORY}/presentation.json`;
export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export interface LoadResult {
  presentation?: Presentation;
  diagnostics: Diagnostic[];
}

const PACES = ['fast', 'slow', 'auto'];
const SCROLLS = ['center', 'centerIfOutside', 'top', 'minimal', 'none'];
const ANCHORED: OperationType[] = ['insertBefore', 'insertAfter', 'replace', 'delete', 'moveCursor', 'selectRange'];
const TEXTUAL: OperationType[] = ['insertBefore', 'insertAfter', 'replace', 'createFile', 'replaceFile'];

export function parsePresentation(source: string): LoadResult {
  let data: unknown;
  try {
    data = JSON.parse(source.replace(/^﻿/, ''));
  } catch (error) {
    return {
      diagnostics: [
        {
          severity: 'error',
          message: `presentation.json is not valid JSON: ${(error as Error).message}`,
          hint: 'Fix the JSON syntax (trailing commas and comments are not allowed).'
        }
      ]
    };
  }
  return validatePresentationObject(data);
}

export function validatePresentationObject(data: unknown): LoadResult {
  const diagnostics: Diagnostic[] = [];
  const error = (message: string, location?: string, extra: Partial<Diagnostic> = {}) =>
    diagnostics.push({ severity: 'error', message, location, ...extra });
  const warning = (message: string, location?: string, extra: Partial<Diagnostic> = {}) =>
    diagnostics.push({ severity: 'warning', message, location, ...extra });

  if (!isObject(data)) {
    error('The presentation must be a JSON object.');
    return { diagnostics };
  }

  checkKnownKeys(data, ['$schema', 'version', 'title', 'description', 'workspace', 'humanMode', 'chapters'], '', warning);

  if (data.version !== 1) error('Missing or unsupported "version"; expected 1.', 'version', { hint: 'Add "version": 1.' });
  if (typeof data.title !== 'string' || data.title.trim() === '') {
    error('Missing required string "title".', 'title', { hint: 'Add a short presentation title.' });
  }
  if (data.description !== undefined && typeof data.description !== 'string') error('"description" must be a string.', 'description');

  // workspace
  if (data.workspace !== undefined) {
    if (!isObject(data.workspace)) {
      error('"workspace" must be an object.', 'workspace');
    } else {
      const workspace = data.workspace;
      checkKnownKeys(workspace, ['workingDirectory', 'initialDirectory', 'finalDirectory', 'files', 'newFileEol'], 'workspace', warning);
      for (const key of ['workingDirectory', 'initialDirectory', 'finalDirectory'] as const) {
        if (workspace[key] === undefined) continue;
        checkPath(workspace[key], `workspace.${key}`, error, true);
      }
      if (workspace.files !== undefined) {
        if (!Array.isArray(workspace.files)) error('"workspace.files" must be an array of relative paths.', 'workspace.files');
        else workspace.files.forEach((file, index) => checkPath(file, `workspace.files[${index}]`, error, false));
      }
      if (workspace.newFileEol !== undefined && !['lf', 'crlf'].includes(workspace.newFileEol as string)) {
        error('"workspace.newFileEol" must be "lf" or "crlf".', 'workspace.newFileEol');
      }
    }
  }

  // humanMode
  if (data.humanMode !== undefined) {
    if (!isObject(data.humanMode)) error('"humanMode" must be an object.', 'humanMode');
    else {
      checkKnownKeys(data.humanMode, ['enabled', 'seed'], 'humanMode', warning);
      if (data.humanMode.enabled !== undefined && typeof data.humanMode.enabled !== 'boolean') {
        error('"humanMode.enabled" must be a boolean.', 'humanMode.enabled');
      }
      if (data.humanMode.seed !== undefined && typeof data.humanMode.seed !== 'string') {
        error('"humanMode.seed" must be a string.', 'humanMode.seed');
      }
    }
  }

  // chapters
  if (!Array.isArray(data.chapters) || data.chapters.length === 0) {
    error('"chapters" must be a non-empty array.', 'chapters', { hint: 'Add at least one chapter with one step.' });
    return { diagnostics };
  }

  const chapterIds = new Map<string, number>();
  const stepIds = new Map<string, string>();
  data.chapters.forEach((chapter: unknown, chapterIndex: number) => {
    const at = `chapters[${chapterIndex}]`;
    if (!isObject(chapter)) {
      error('Each chapter must be an object.', at);
      return;
    }
    checkKnownKeys(chapter, ['id', 'title', 'objective', 'steps'], at, warning);
    const chapterId = typeof chapter.id === 'string' ? chapter.id : undefined;
    if (!chapterId || !ID_PATTERN.test(chapterId)) {
      error(`Chapter ${chapterIndex + 1} needs an "id" made of letters, digits, ".", "_" or "-".`, `${at}.id`);
    } else if (chapterIds.has(chapterId)) {
      error(`Duplicate chapter id "${chapterId}".`, `${at}.id`, {
        chapterId,
        hint: `Chapter ids must be unique; "${chapterId}" is already used by chapter ${(chapterIds.get(chapterId) ?? 0) + 1}.`
      });
    } else {
      chapterIds.set(chapterId, chapterIndex);
    }
    if (typeof chapter.title !== 'string' || chapter.title.trim() === '') {
      error(`Chapter "${chapterId ?? chapterIndex + 1}" needs a "title".`, `${at}.title`, { chapterId });
    }
    if (chapter.objective !== undefined && typeof chapter.objective !== 'string') error('"objective" must be a string.', `${at}.objective`);
    if (!Array.isArray(chapter.steps) || chapter.steps.length === 0) {
      error(`Chapter "${chapterId ?? chapterIndex + 1}" needs a non-empty "steps" array.`, `${at}.steps`, { chapterId });
      return;
    }

    chapter.steps.forEach((step: unknown, stepIndex: number) => {
      const stepAt = `${at}.steps[${stepIndex}]`;
      if (!isObject(step)) {
        error('Each step must be an object.', stepAt, { chapterId });
        return;
      }
      checkKnownKeys(step, ['id', 'title', 'objective', 'pace', 'thinking', 'operations'], stepAt, warning);
      const stepId = typeof step.id === 'string' ? step.id : undefined;
      if (!stepId || !ID_PATTERN.test(stepId)) {
        error(`Step ${stepIndex + 1} of chapter "${chapterId}" needs an "id" made of letters, digits, ".", "_" or "-".`, `${stepAt}.id`, { chapterId });
      } else if (stepIds.has(stepId)) {
        error(`Duplicate step id "${stepId}".`, `${stepAt}.id`, {
          chapterId,
          stepId,
          hint: `Step ids must be unique across the whole presentation; "${stepId}" is already used in chapter "${stepIds.get(stepId)}".`
        });
      } else {
        stepIds.set(stepId, chapterId ?? String(chapterIndex));
      }
      const context = { chapterId, stepId };
      if (typeof step.title !== 'string' || step.title.trim() === '') error(`Step "${stepId}" needs a "title".`, `${stepAt}.title`, context);
      for (const key of ['objective', 'thinking'] as const) {
        if (step[key] !== undefined && typeof step[key] !== 'string') error(`"${key}" must be a string.`, `${stepAt}.${key}`, context);
      }
      if (step.pace !== undefined && !PACES.includes(step.pace as string)) {
        error(`"pace" must be one of ${PACES.join(', ')}.`, `${stepAt}.pace`, context);
      }
      if (!Array.isArray(step.operations) || step.operations.length === 0) {
        error(`Step "${stepId}" needs a non-empty "operations" array.`, `${stepAt}.operations`, context);
        return;
      }
      step.operations.forEach((operation: unknown, operationIndex: number) =>
        validateOperation(operation, `${stepAt}.operations[${operationIndex}]`, context, error, warning)
      );
    });
  });

  if (diagnostics.some((item) => item.severity === 'error')) return { diagnostics };
  return { presentation: data as unknown as Presentation, diagnostics };
}

function validateOperation(
  operation: unknown,
  at: string,
  context: { chapterId?: string; stepId?: string },
  error: (message: string, location?: string, extra?: Partial<Diagnostic>) => void,
  warning: (message: string, location?: string, extra?: Partial<Diagnostic>) => void
): void {
  if (!isObject(operation)) {
    error('Each operation must be an object.', at, context);
    return;
  }
  checkKnownKeys(
    operation,
    ['type', 'file', 'label', 'anchor', 'text', 'expectBefore', 'expectAfter', 'pace', 'thinking', 'effects', 'scroll', 'cursor', 'transient'],
    at,
    warning
  );
  const type = operation.type as OperationType;
  if (!OPERATION_TYPES.includes(type)) {
    error(`Unknown operation type "${String(operation.type)}". Use one of: ${OPERATION_TYPES.join(', ')}.`, `${at}.type`, context);
    return;
  }
  const file = checkPath(operation.file, `${at}.file`, (message, location) => error(message, location, context), false);
  const extra = { ...context, file };

  if (ANCHORED.includes(type)) {
    if (!isObject(operation.anchor)) {
      error(`"${type}" requires an "anchor".`, `${at}.anchor`, { ...extra, hint: 'Add "anchor": { "text": "..." } with text that occurs exactly once.' });
    } else {
      validateAnchor(operation.anchor as Anchor, type, `${at}.anchor`, extra, error);
    }
  } else if (operation.anchor !== undefined && type !== 'openFile') {
    warning(`"anchor" is ignored for "${type}".`, `${at}.anchor`, extra);
  } else if (type === 'openFile' && operation.anchor !== undefined && isObject(operation.anchor)) {
    validateAnchor(operation.anchor as Anchor, type, `${at}.anchor`, extra, error);
  }

  if (operation.text !== undefined) {
    const valid = typeof operation.text === 'string' || (Array.isArray(operation.text) && operation.text.every((line) => typeof line === 'string'));
    if (!valid) error('"text" must be a string or an array of strings.', `${at}.text`, extra);
  }
  if (TEXTUAL.includes(type) && operation.text === undefined && type !== 'createFile') {
    error(`"${type}" requires "text" (use "delete" to remove code).`, `${at}.text`, extra);
  }
  if (!TEXTUAL.includes(type) && operation.text !== undefined) {
    warning(`"text" is ignored for "${type}".`, `${at}.text`, extra);
  }
  if (type === 'replaceFile' && operation.transient !== true) {
    error(
      '"replaceFile" is only allowed as a declared instant change. Set "transient": true, or animate the change with insert/replace/delete operations.',
      `${at}.transient`,
      extra
    );
  }
  if (operation.transient !== undefined && typeof operation.transient !== 'boolean') error('"transient" must be a boolean.', `${at}.transient`, extra);
  for (const key of ['label', 'expectBefore', 'expectAfter', 'thinking'] as const) {
    if (operation[key] !== undefined && typeof operation[key] !== 'string') error(`"${key}" must be a string.`, `${at}.${key}`, extra);
  }
  if (operation.pace !== undefined && !PACES.includes(operation.pace as string)) error(`"pace" must be one of ${PACES.join(', ')}.`, `${at}.pace`, extra);
  if (operation.scroll !== undefined && !SCROLLS.includes(operation.scroll as string)) {
    error(`"scroll" must be one of ${SCROLLS.join(', ')}.`, `${at}.scroll`, extra);
  }
  if (operation.cursor !== undefined && !['start', 'end'].includes(operation.cursor as string)) error('"cursor" must be "start" or "end".', `${at}.cursor`, extra);
  if (operation.effects !== undefined) {
    if (!isObject(operation.effects)) error('"effects" must be an object.', `${at}.effects`, extra);
    else {
      checkKnownKeys(operation.effects, ['auto', 'suggestAfter', 'parameterHintsAfter'], `${at}.effects`, warning);
      if (operation.effects.auto !== undefined && typeof operation.effects.auto !== 'boolean') error('"effects.auto" must be a boolean.', `${at}.effects.auto`, extra);
      for (const key of ['suggestAfter', 'parameterHintsAfter'] as const) {
        const list = operation.effects[key];
        if (list !== undefined && !(Array.isArray(list) && list.every((item) => typeof item === 'string' && item.length > 0))) {
          error(`"effects.${key}" must be an array of non-empty strings.`, `${at}.effects.${key}`, extra);
        }
      }
    }
  }
}

function validateAnchor(
  anchor: Anchor,
  type: OperationType,
  at: string,
  extra: Partial<Diagnostic>,
  error: (message: string, location?: string, extra?: Partial<Diagnostic>) => void
): void {
  const hasText = anchor.text !== undefined;
  const hasRegex = anchor.regex !== undefined;
  const hasLine = anchor.line !== undefined;
  if (hasText && hasRegex) error('Use either "anchor.text" or "anchor.regex", not both.', at, extra);
  if (!hasText && !hasRegex && !hasLine) {
    error('An anchor needs "text", "regex" or "line".', at, { ...extra, hint: 'Prefer a short, unique "text" anchor.' });
  }
  if (hasText && (typeof anchor.text !== 'string' || anchor.text.length === 0)) error('"anchor.text" must be a non-empty string.', `${at}.text`, extra);
  if (hasRegex) {
    if (typeof anchor.regex !== 'string' || anchor.regex.length === 0) error('"anchor.regex" must be a non-empty string.', `${at}.regex`, extra);
    else {
      const flags = anchor.flags ?? '';
      if (typeof flags !== 'string' || !/^[imsu]*$/.test(flags)) {
        error('"anchor.flags" may only contain i, m, s and u.', `${at}.flags`, extra);
      } else {
        try {
          new RegExp(anchor.regex, flags);
        } catch (failure) {
          error(`"anchor.regex" is not a valid regular expression: ${(failure as Error).message}`, `${at}.regex`, extra);
        }
      }
    }
  }
  for (const key of ['line', 'column', 'endLine', 'endColumn'] as const) {
    const value = anchor[key];
    if (value !== undefined && !(Number.isInteger(value) && value >= 1)) error(`"anchor.${key}" must be an integer ≥ 1.`, `${at}.${key}`, extra);
  }
  if (anchor.column !== undefined && anchor.line === undefined) error('"anchor.column" requires "anchor.line".', `${at}.column`, extra);
  if ((anchor.endLine !== undefined) !== (anchor.endColumn !== undefined)) error('"anchor.endLine" and "anchor.endColumn" must be used together.', at, extra);
  if (anchor.endLine !== undefined && (hasText || hasRegex)) error('"anchor.endLine" cannot be combined with text or regex anchors.', at, extra);
  if (!hasText && !hasRegex && hasLine && ['replace', 'delete', 'selectRange'].includes(type) && anchor.endLine === undefined) {
    error(`A line/column anchor for "${type}" needs "endLine" and "endColumn".`, at, extra);
  }
}

function checkPath(
  value: unknown,
  location: string,
  error: (message: string, location?: string) => void,
  directory: boolean
): string | undefined {
  if (typeof value !== 'string') {
    error(`${location} must be a relative path string.`, location);
    return undefined;
  }
  try {
    const normalized = normalizeRelativePath(value, location);
    if (!directory && normalized === '.') {
      error(`${location} must name a file.`, location);
      return undefined;
    }
    if (isSensitivePath(normalized)) {
      error(
        `${location} "${value}" points at an environment, credential, dependency or VCS path. Better Live Coding never reads or writes those.`,
        location
      );
      return undefined;
    }
    return normalized;
  } catch (failure) {
    if (failure instanceof PathError) {
      error(failure.message, location);
      return undefined;
    }
    throw failure;
  }
}

function checkKnownKeys(
  object: Record<string, unknown>,
  keys: string[],
  at: string,
  warning: (message: string, location?: string) => void
): void {
  for (const key of Object.keys(object)) {
    if (!keys.includes(key)) warning(`Unknown property "${key}" is ignored.`, at ? `${at}.${key}` : key);
  }
}

function isObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
