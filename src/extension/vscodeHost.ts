/**
 * EditorHost implementation backed by real VS Code editors.
 * Only files below the working directory are ever touched.
 */

import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import { ScrollPolicy } from '../config/types';
import { EditorHost } from '../engine/host';
import { EditSuppressor } from '../engine/suppressor';
import { resolveInside } from '../checkpoints/fileStore';
import { Eol, Position } from '../utilities/text';
import { isInside } from '../utilities/paths';

export class VscodeHost implements EditorHost {
  readonly suppressor = new EditSuppressor();

  constructor(
    private readonly root: string,
    private readonly onStatus: (text: string) => void,
    private readonly output: vscode.OutputChannel
  ) {}

  relative(uri: vscode.Uri): string | undefined {
    if (uri.scheme !== 'file' || !isInside(this.root, uri.fsPath)) return undefined;
    return path.relative(this.root, uri.fsPath).replace(/\\/g, '/');
  }

  private async uri(file: string): Promise<vscode.Uri> {
    return vscode.Uri.file(await resolveInside(this.root, file));
  }

  private document(uri: vscode.Uri): vscode.TextDocument | undefined {
    return vscode.workspace.textDocuments.find((document) => document.uri.toString() === uri.toString() && !document.isClosed);
  }

  private async editorFor(file: string): Promise<vscode.TextEditor> {
    const uri = await this.uri(file);
    const visible = vscode.window.visibleTextEditors.find((editor) => editor.document.uri.toString() === uri.toString());
    if (visible && vscode.window.activeTextEditor === visible) return visible;
    const document = this.document(uri) ?? (await vscode.workspace.openTextDocument(uri));
    return vscode.window.showTextDocument(document, { preview: false, preserveFocus: false, viewColumn: visible?.viewColumn });
  }

  async readFile(file: string): Promise<string | undefined> {
    const uri = await this.uri(file);
    const document = this.document(uri);
    // A clean document whose file was deleted is a stale model, not a file.
    if (document && (document.isDirty || (await fileExists(uri.fsPath)))) return document.getText();
    try {
      return await fs.readFile(uri.fsPath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async openFile(file: string, options?: { create?: boolean; eol?: Eol }): Promise<void> {
    const uri = await this.uri(file);
    if (options?.create) {
      await fs.mkdir(path.dirname(uri.fsPath), { recursive: true });
      const existing = await this.readFile(file);
      if (existing !== undefined && existing !== '') throw new Error(`Cannot create ${file}: it already exists.`);
      if (existing === undefined) await this.suppressor.run(file, () => fs.writeFile(uri.fsPath, '', 'utf8'));
    }
    const editor = await this.editorFor(file);
    if (options?.create && options.eol) {
      const wanted = options.eol === 'crlf' ? vscode.EndOfLine.CRLF : vscode.EndOfLine.LF;
      if (editor.document.eol !== wanted) {
        await this.suppressor.run(file, () => Promise.resolve(editor.edit((builder) => builder.setEndOfLine(wanted))), () => editor.document.version);
      }
    }
  }

  activeFile(): string | undefined {
    const editor = vscode.window.activeTextEditor;
    return editor ? this.relative(editor.document.uri) : undefined;
  }

  eolOf(file: string): Eol {
    const uri = vscode.Uri.file(path.resolve(this.root, file));
    const document = this.document(uri);
    return document?.eol === vscode.EndOfLine.CRLF ? 'crlf' : 'lf';
  }

  async setSelection(file: string, anchor: Position, active: Position, scroll: ScrollPolicy): Promise<void> {
    const editor = await this.editorFor(file);
    const start = new vscode.Position(anchor.line, anchor.character);
    const end = new vscode.Position(active.line, active.character);
    editor.selection = new vscode.Selection(start, end);
    if (scroll === 'none') return;
    const type =
      scroll === 'center'
        ? vscode.TextEditorRevealType.InCenter
        : scroll === 'top'
          ? vscode.TextEditorRevealType.AtTop
          : scroll === 'minimal'
            ? vscode.TextEditorRevealType.Default
            : vscode.TextEditorRevealType.InCenterIfOutsideViewport;
    editor.revealRange(new vscode.Range(start, end), type);
  }

  async insert(file: string, at: Position, text: string): Promise<void> {
    const editor = await this.editorFor(file);
    await this.suppressor.run(
      file,
      async () => {
        const ok = await editor.edit((builder) => builder.insert(new vscode.Position(at.line, at.character), text), {
          undoStopBefore: false,
          undoStopAfter: false
        });
        if (!ok) throw new Error(`VS Code rejected an edit in ${file}.`);
      },
      () => editor.document.version
    );
  }

  async delete(file: string, start: Position, end: Position): Promise<void> {
    const editor = await this.editorFor(file);
    await this.suppressor.run(
      file,
      async () => {
        const ok = await editor.edit(
          (builder) => builder.delete(new vscode.Range(new vscode.Position(start.line, start.character), new vscode.Position(end.line, end.character))),
          { undoStopBefore: false, undoStopAfter: false }
        );
        if (!ok) throw new Error(`VS Code rejected an edit in ${file}.`);
      },
      () => editor.document.version
    );
  }

  async writeFile(file: string, text: string): Promise<void> {
    const uri = await this.uri(file);
    const document = this.document(uri);
    if (!document) {
      await fs.mkdir(path.dirname(uri.fsPath), { recursive: true });
      await this.suppressor.run(file, () => fs.writeFile(uri.fsPath, text, 'utf8'));
      return;
    }
    const wanted = /\r\n/.test(text) ? vscode.EndOfLine.CRLF : /\n/.test(text) ? vscode.EndOfLine.LF : document.eol;
    await this.suppressor.run(
      file,
      async () => {
        const edit = new vscode.WorkspaceEdit();
        edit.replace(uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), text);
        if (!(await vscode.workspace.applyEdit(edit))) throw new Error(`Could not write ${file}.`);
        if (document.eol !== wanted) {
          const editor = await this.editorFor(file);
          await editor.edit((builder) => builder.setEndOfLine(wanted));
        }
      },
      () => document.version
    );
  }

  async deleteFile(file: string): Promise<void> {
    const uri = await this.uri(file);
    await this.suppressor.run(file, async () => {
      for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
          if (tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === uri.toString()) {
            await vscode.window.tabGroups.close(tab, true);
          }
        }
      }
      const document = this.document(uri);
      if (document?.isDirty) {
        // Discard unsaved presentation-owned content before deleting.
        await vscode.window.showTextDocument(document, { preview: false });
        await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
      }
      await fs.rm(uri.fsPath, { force: true });
    });
  }

  async saveWithoutFormatting(file: string): Promise<void> {
    const uri = await this.uri(file);
    const document = this.document(uri);
    if (!document || !document.isDirty) return;
    await this.suppressor.run(file, async () => {
      const active = vscode.window.activeTextEditor;
      if (active?.document.uri.toString() !== uri.toString()) {
        await vscode.window.showTextDocument(document, { preview: false, preserveFocus: false });
      }
      try {
        await vscode.commands.executeCommand('workbench.action.files.saveWithoutFormatting');
      } catch (error) {
        this.output.appendLine(`saveWithoutFormatting unavailable: ${(error as Error).message}`);
      }
      if (document.isDirty) {
        this.output.appendLine(`Falling back to a regular save for ${file}; format-on-save may apply.`);
        await document.save();
      }
    });
  }

  async triggerSuggest(): Promise<void> {
    await safeCommand('editor.action.triggerSuggest');
  }

  async triggerParameterHints(): Promise<void> {
    await safeCommand('editor.action.triggerParameterHints');
  }

  async hideWidgets(): Promise<void> {
    await safeCommand('hideSuggestWidget');
    await safeCommand('closeParameterHints');
  }

  status(text: string): void {
    this.onStatus(text);
  }

  log(text: string): void {
    this.output.appendLine(text);
  }
}

async function safeCommand(command: string): Promise<void> {
  try {
    await vscode.commands.executeCommand(command);
  } catch {
    // Command not available for this editor/language; effects are optional.
  }
}

async function fileExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}
