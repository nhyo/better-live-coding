/**
 * Editor hosts without VS Code: an in-memory editor that behaves like VS Code
 * documents (line/character positions, per-document EOL) and a disk-backed
 * variant used for headless replays. Also a virtual clock.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { ScrollPolicy } from '../config/types';
import { Clock, EditorHost } from '../engine/host';
import { Eol, Position, applyEol, detectEol, eolString, normalizeEol, positionToOffset } from '../utilities/text';

export interface HostEvent {
  type: 'open' | 'select' | 'insert' | 'delete' | 'write' | 'deleteFile' | 'save' | 'suggest' | 'hints' | 'hide' | 'status';
  file?: string;
  detail?: string;
  at?: Position;
  end?: Position;
  time: number;
}

interface Document {
  /** Text with the document's real line endings. */
  raw: string;
  eol: Eol;
  dirty: boolean;
}

export class VirtualClock implements Clock {
  now = 0;
  /** Called on each sleep; lets tests pause/resume/skip at precise moments. */
  onSleep: ((clock: VirtualClock) => void) | undefined;
  async sleep(milliseconds: number): Promise<void> {
    this.now += Math.max(0, milliseconds);
    this.onSleep?.(this);
    await Promise.resolve();
  }
}

export class MemoryHost implements EditorHost {
  readonly documents = new Map<string, Document>();
  readonly events: HostEvent[] = [];
  /** Files on "disk" (raw text). */
  readonly disk = new Map<string, string>();
  active: string | undefined;
  selection: { file: string; anchor: Position; active: Position } | undefined;
  /** Hook invoked before every insert (tests use it to simulate keystrokes or pauses). */
  beforeInsert: ((file: string, at: Position, text: string) => void) | undefined;
  widgetsVisible = false;

  constructor(
    files: Record<string, string> = {},
    readonly clock?: VirtualClock
  ) {
    for (const [file, text] of Object.entries(files)) this.disk.set(file, text);
  }

  protected record(event: Omit<HostEvent, 'time'>): void {
    this.events.push({ ...event, time: this.clock?.now ?? 0 });
  }

  protected loadFromDisk(file: string): string | undefined {
    return this.disk.get(file);
  }

  protected writeToDisk(file: string, text: string): void {
    this.disk.set(file, text);
  }

  protected removeFromDisk(file: string): void {
    this.disk.delete(file);
  }

  private doc(file: string): Document {
    const document = this.documents.get(file);
    if (!document) throw new Error(`${file} is not open.`);
    return document;
  }

  async readFile(file: string): Promise<string | undefined> {
    const document = this.documents.get(file);
    if (document) return document.raw;
    return this.loadFromDisk(file);
  }

  async openFile(file: string, options?: { create?: boolean; eol?: Eol }): Promise<void> {
    if (!this.documents.has(file)) {
      let raw = this.loadFromDisk(file);
      if (raw === undefined) {
        if (!options?.create) throw new Error(`${file} does not exist.`);
        raw = '';
        this.writeToDisk(file, '');
      }
      this.documents.set(file, { raw, eol: options?.eol ?? detectEol(raw), dirty: false });
    } else if (options?.create && this.doc(file).raw !== '') {
      throw new Error(`${file} already exists.`);
    }
    this.active = file;
    this.record({ type: 'open', file });
  }

  activeFile(): string | undefined {
    return this.active;
  }

  eolOf(file: string): Eol {
    return this.documents.get(file)?.eol ?? 'lf';
  }

  async setSelection(file: string, anchor: Position, active: Position, _scroll: ScrollPolicy): Promise<void> {
    if (this.active !== file) throw new Error(`Selection set on ${file} while ${this.active} is active.`);
    this.selection = { file, anchor, active };
    this.record({ type: 'select', file, at: anchor, end: active });
  }

  /** Converts a line/character position to an offset in the RAW (possibly CRLF) text. */
  private rawOffset(document: Document, position: Position): number {
    const lines = document.raw.split(eolString(document.eol));
    if (position.line >= lines.length) throw new Error(`Line ${position.line} out of range.`);
    if (position.character > lines[position.line].length) throw new Error(`Character ${position.character} out of range on line ${position.line}.`);
    let offset = 0;
    for (let line = 0; line < position.line; line += 1) offset += lines[line].length + eolString(document.eol).length;
    return offset + position.character;
  }

  async insert(file: string, at: Position, text: string): Promise<void> {
    this.beforeInsert?.(file, at, text);
    const document = this.doc(file);
    const offset = this.rawOffset(document, at);
    // Like VS Code, inserted line breaks follow the document EOL.
    const inserted = applyEol(text, document.eol);
    document.raw = document.raw.slice(0, offset) + inserted + document.raw.slice(offset);
    document.dirty = true;
    this.record({ type: 'insert', file, at, detail: text });
  }

  async delete(file: string, start: Position, end: Position): Promise<void> {
    const document = this.doc(file);
    const from = this.rawOffset(document, start);
    const to = this.rawOffset(document, end);
    document.raw = document.raw.slice(0, from) + document.raw.slice(to);
    document.dirty = true;
    this.record({ type: 'delete', file, at: start, end });
  }

  async writeFile(file: string, text: string): Promise<void> {
    const document = this.documents.get(file);
    if (document) {
      document.raw = text;
      document.eol = detectEol(text, document.eol);
      document.dirty = true;
    } else {
      this.writeToDisk(file, text);
    }
    this.record({ type: 'write', file });
  }

  async deleteFile(file: string): Promise<void> {
    this.documents.delete(file);
    this.removeFromDisk(file);
    if (this.active === file) this.active = undefined;
    this.record({ type: 'deleteFile', file });
  }

  /** Simulated formatter that would run on a normal save; must never be applied here. */
  formatOnSave: ((text: string) => string) | undefined;

  async saveWithoutFormatting(file: string): Promise<void> {
    const document = this.documents.get(file);
    if (!document) return;
    this.writeToDisk(file, document.raw);
    document.dirty = false;
    this.record({ type: 'save', file, detail: 'withoutFormatting' });
  }

  async triggerSuggest(): Promise<void> {
    this.widgetsVisible = true;
    this.record({ type: 'suggest', file: this.active });
  }

  async triggerParameterHints(): Promise<void> {
    this.widgetsVisible = true;
    this.record({ type: 'hints', file: this.active });
  }

  async hideWidgets(): Promise<void> {
    this.widgetsVisible = false;
    this.record({ type: 'hide' });
  }

  readonly statuses: string[] = [];
  status(text: string): void {
    this.statuses.push(text);
    this.record({ type: 'status', detail: text });
  }

  readonly logs: string[] = [];
  log(text: string): void {
    this.logs.push(text);
  }

  /** Simulates the user typing into a document (an external modification). */
  externalEdit(file: string, text: string): void {
    const document = this.documents.get(file);
    if (document) {
      document.raw = text + document.raw;
      document.dirty = true;
    } else {
      const raw = this.loadFromDisk(file) ?? '';
      this.writeToDisk(file, text + raw);
    }
  }

  /** Normalized content as seen on disk (after saves). */
  diskText(file: string): string | undefined {
    const raw = this.loadFromDisk(file);
    return raw === undefined ? undefined : normalizeEol(raw);
  }

  /** Simple helper for tests: offset of a position in normalized text. */
  static offset(text: string, position: Position): number {
    return positionToOffset(normalizeEol(text), position);
  }
}

/** Disk-backed host rooted at a directory; only declared files are touched by the session. */
export class DiskHost extends MemoryHost {
  constructor(
    private readonly root: string,
    clock?: VirtualClock
  ) {
    super({}, clock);
  }

  private absolute(file: string): string {
    const target = path.resolve(this.root, file);
    if (!target.startsWith(path.resolve(this.root))) throw new Error(`${file} escapes ${this.root}`);
    return target;
  }

  protected override loadFromDisk(file: string): string | undefined {
    try {
      return fs.readFileSync(this.absolute(file), 'utf8');
    } catch {
      return undefined;
    }
  }

  protected override writeToDisk(file: string, text: string): void {
    fs.mkdirSync(path.dirname(this.absolute(file)), { recursive: true });
    fs.writeFileSync(this.absolute(file), text, 'utf8');
  }

  protected override removeFromDisk(file: string): void {
    fs.rmSync(this.absolute(file), { force: true });
  }
}
