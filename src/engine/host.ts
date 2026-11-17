/**
 * The editor host abstraction. The VS Code adapter implements it with real
 * editors; tests and headless replays implement it in memory. Every position is
 * a zero-based line/character pair, so LF and CRLF documents behave the same.
 */

import { ScrollPolicy } from '../config/types';
import { Eol, Position } from '../utilities/text';

export interface EditorHost {
  /** Raw text (original line endings) of a declared file, or undefined if it does not exist. */
  readFile(file: string): Promise<string | undefined>;
  /** Opens (and focuses) a file in the editor. Creates an empty file first when `create` is set. */
  openFile(file: string, options?: { create?: boolean; eol?: Eol }): Promise<void>;
  /** The declared file shown in the active editor, if any. */
  activeFile(): string | undefined;
  /** Line ending of an open document. */
  eolOf(file: string): Eol;
  setSelection(file: string, anchor: Position, active: Position, scroll: ScrollPolicy): Promise<void>;
  insert(file: string, at: Position, text: string): Promise<void>;
  delete(file: string, start: Position, end: Position): Promise<void>;
  /** Writes a whole file (text already uses the desired line endings). */
  writeFile(file: string, text: string): Promise<void>;
  deleteFile(file: string): Promise<void>;
  /** Saves without running formatters or other save participants. */
  saveWithoutFormatting(file: string): Promise<void>;
  triggerSuggest(): Promise<void>;
  triggerParameterHints(): Promise<void>;
  hideWidgets(): Promise<void>;
  status(text: string): void;
  log(text: string): void;
}

export interface Clock {
  sleep(milliseconds: number): Promise<void>;
}

export const realClock: Clock = {
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, Math.max(0, milliseconds)))
};
