/**
 * Pure operation planning and application on LF-normalized file sets.
 * Both the animated runner and the checkpoint builder use `planOperation`, so
 * an animation and a skip always produce the same text.
 */

import { Operation, Step, operationLabel, operationText } from '../config/types';
import { offsetToPosition, normalizeEol, Position, preview } from '../utilities/text';
import { AnchorError, resolveAnchor } from './anchors';

/** Declared file contents (LF-normalized). `null` means the file does not exist. */
export type FileSet = Record<string, string | null>;

export class OperationError extends Error {
  constructor(
    message: string,
    readonly file: string,
    readonly hint?: string
  ) {
    super(message);
  }
}

export type OperationPlan =
  | {
      kind: 'edit';
      file: string;
      /** Range to remove (normalized offsets) before typing. Equal start/end for pure inserts. */
      deleteStart: number;
      deleteEnd: number;
      insertText: string;
      /** Show the range as a selection before replacing / deleting. */
      showSelection: boolean;
      before: string;
      after: string;
    }
  | { kind: 'createFile'; file: string; insertText: string; after: string }
  | { kind: 'deleteFile'; file: string; before: string }
  | { kind: 'replaceFile'; file: string; before: string; after: string }
  | { kind: 'cursor'; file: string; start: number; end: number; select: boolean; before: string }
  | { kind: 'open'; file: string; start?: number; end?: number; before: string };

export function planOperation(files: FileSet, operation: Operation, index = 0): OperationPlan {
  const label = operationLabel(operation, index);
  const file = operation.file;
  const current = files[file];
  const text = normalizeEol(operationText(operation));

  if (operation.type === 'createFile') {
    if (current !== null && current !== undefined) {
      throw new OperationError(`Cannot create ${file} for ${label}: the file already exists.`, file, 'Remove the createFile operation or delete the file in an earlier step.');
    }
    return finish({ kind: 'createFile' as const, file, insertText: text, after: text }, operation, label);
  }

  if (current === null || current === undefined) {
    throw new OperationError(`File ${file} does not exist when ${label} runs.`, file, 'Create it in an earlier step, or check the working directory and the initial checkpoint.');
  }

  if (operation.expectBefore !== undefined && !current.includes(normalizeEol(operation.expectBefore))) {
    throw new OperationError(
      `Expected text is missing before ${label}: "${preview(operation.expectBefore)}".`,
      file,
      'The file is not in the state this step expects. Restore the step checkpoint.'
    );
  }

  const range = () => {
    try {
      return resolveAnchor(current, operation.anchor!, `${label} in ${file}`);
    } catch (error) {
      if (error instanceof AnchorError) throw new OperationError(error.message, file, error.hint);
      throw error;
    }
  };

  switch (operation.type) {
    case 'deleteFile':
      return { kind: 'deleteFile', file, before: current };
    case 'replaceFile':
      return finish({ kind: 'replaceFile' as const, file, before: current, after: text }, operation, label);
    case 'openFile': {
      if (!operation.anchor) return { kind: 'open', file, before: current };
      const { start, end } = range();
      return { kind: 'open', file, start, end, before: current };
    }
    case 'moveCursor': {
      const { start, end } = range();
      const at = operation.cursor === 'end' ? end : start;
      return { kind: 'cursor', file, start: at, end: at, select: false, before: current };
    }
    case 'selectRange': {
      const { start, end } = range();
      return { kind: 'cursor', file, start, end, select: true, before: current };
    }
    case 'insertBefore':
    case 'insertAfter':
    case 'replace':
    case 'delete': {
      const { start, end } = range();
      let deleteStart = start;
      let deleteEnd = end;
      let insertText = text;
      if (operation.type === 'insertBefore') deleteEnd = start;
      if (operation.type === 'insertAfter') deleteStart = end;
      if (operation.type === 'delete') insertText = '';
      if (operation.type === 'insertBefore' || operation.type === 'insertAfter') deleteEnd = deleteStart;
      const after = current.slice(0, deleteStart) + insertText + current.slice(deleteEnd);
      return finish(
        {
          kind: 'edit' as const,
          file,
          deleteStart,
          deleteEnd,
          insertText,
          showSelection: deleteEnd > deleteStart,
          before: current,
          after
        },
        operation,
        label
      );
    }
    default:
      throw new OperationError(`Unsupported operation type ${(operation as Operation).type}.`, file);
  }
}

function finish<T extends { after: string; file: string }>(plan: T, operation: Operation, label: string): T {
  if (operation.expectAfter !== undefined && !plan.after.includes(normalizeEol(operation.expectAfter))) {
    throw new OperationError(
      `Expected text is missing after ${label}: "${preview(operation.expectAfter)}".`,
      plan.file,
      'Check the operation text or the expectAfter value.'
    );
  }
  return plan;
}

export function applyPlan(files: FileSet, plan: OperationPlan): FileSet {
  switch (plan.kind) {
    case 'edit':
    case 'createFile':
    case 'replaceFile':
      return { ...files, [plan.file]: plan.after };
    case 'deleteFile':
      return { ...files, [plan.file]: null };
    default:
      return files;
  }
}

export function applyOperation(files: FileSet, operation: Operation, index = 0): FileSet {
  return applyPlan(files, planOperation(files, operation, index));
}

export class StepError extends Error {
  constructor(
    message: string,
    readonly stepId: string,
    readonly operationIndex: number,
    readonly file?: string,
    readonly hint?: string
  ) {
    super(message);
  }
}

/** Applies all operations of a step as one transaction. Throws without partial results. */
export function applyStep(files: FileSet, step: Step): FileSet {
  let next = files;
  step.operations.forEach((operation, index) => {
    try {
      next = applyOperation(next, operation, index);
    } catch (error) {
      const failure = error as OperationError;
      throw new StepError(`Step "${step.id}" operation ${index + 1}: ${failure.message}`, step.id, index, failure.file, failure.hint);
    }
  });
  return next;
}

export function positionIn(normalized: string, offset: number): Position {
  return offsetToPosition(normalized, offset);
}
