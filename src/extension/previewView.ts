/**
 * Read-only sidebar preview. Lives in its own activity-bar container so it
 * never covers the editor area; it can be collapsed or closed at any time.
 */

import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { PreviewState, renderPreviewHtml } from '../presentation/preview';

export class PreviewViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'betterLiveCoding.preview';
  private view: vscode.WebviewView | undefined;
  private state: PreviewState | undefined;

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: false, enableCommandUris: false, localResourceRoots: [] };
    this.render();
  }

  update(state: PreviewState | undefined): void {
    this.state = state;
    this.render();
  }

  private render(): void {
    if (!this.view) return;
    const nonce = randomBytes(16).toString('base64');
    this.view.webview.html = renderPreviewHtml(this.state, nonce, this.view.webview.cspSource);
  }
}
