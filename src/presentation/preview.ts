/**
 * Read-only preview model and HTML for the side panel. Pure functions so the
 * rendering is testable without VS Code.
 */

import { FlatStep, Presentation } from '../config/types';
import { resolvePace } from '../engine/pacing';

export interface PreviewState {
  presentation: Presentation;
  steps: FlatStep[];
  completedSteps: number;
  active: boolean;
  running: boolean;
  paused: boolean;
  checkpointLabel: string;
}

export function statusText(steps: FlatStep[], completedSteps: number): string {
  if (steps.length === 0) return 'No steps';
  if (completedSteps >= steps.length) return 'Complete';
  const next = steps[completedSteps];
  return `Stage ${next.chapterIndex + 1} · Step ${next.stepIndexInChapter + 1}/${next.stepsInChapter}`;
}

export function stepPace(flat: FlatStep): string {
  const paces = new Set(flat.step.operations.filter((operation) => !['moveCursor', 'selectRange', 'openFile', 'deleteFile'].includes(operation.type)).map((operation) => resolvePace(operation, flat.step)));
  if (paces.size === 0) return '—';
  return [...paces].sort().join(' + ');
}

export function stepFiles(flat: FlatStep): string[] {
  const files: string[] = [];
  for (const operation of flat.step.operations) if (!files.includes(operation.file)) files.push(operation.file);
  return files;
}

export function renderPreviewHtml(state: PreviewState | undefined, nonce: string, cspSource: string): string {
  const head = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style nonce="${nonce}">
body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground);padding:0 8px 12px}
h1{font-size:1.1em;margin:10px 0 4px}h2{font-size:1em;margin:14px 0 4px;color:var(--vscode-descriptionForeground)}
.badge{display:inline-block;padding:1px 6px;border-radius:8px;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);font-size:.85em}
.muted{color:var(--vscode-descriptionForeground)}ul{padding-left:18px;margin:4px 0}li{margin:2px 0}
.current{font-weight:600}.done{opacity:.6}code{font-family:var(--vscode-editor-font-family)}
table{border-collapse:collapse}td{padding:1px 8px 1px 0;vertical-align:top}kbd{border:1px solid var(--vscode-widget-border,#888);border-radius:3px;padding:0 3px;font-size:.85em}
</style></head><body>`;
  if (!state) {
    return `${head}<h1>Better Live Coding</h1><p class="muted">No presentation loaded. Run <b>Better Live Coding: Initialize Presentation</b> or <b>Start Presentation Mode</b>.</p></body></html>`;
  }
  const { presentation, steps, completedSteps } = state;
  const current = steps[completedSteps];
  const next = steps[completedSteps + 1];
  const mode = !state.active ? 'Not presenting' : state.paused ? 'Paused' : state.running ? 'Typing' : 'Waiting for Enter';
  const parts: string[] = [head];
  parts.push(`<h1>${escapeHtml(presentation.title)}</h1>`);
  parts.push(`<p><span class="badge">${escapeHtml(statusText(steps, completedSteps))}</span> <span class="muted">${escapeHtml(mode)}</span></p>`);
  parts.push(`<p class="muted">Checkpoint: ${escapeHtml(state.checkpointLabel)}</p>`);
  if (current) {
    parts.push(`<h2>${state.running ? 'Current step' : 'Next step (Enter)'}</h2>`);
    parts.push(`<table>
<tr><td class="muted">Chapter</td><td>${escapeHtml(current.chapter.title)}</td></tr>
<tr><td class="muted">Step</td><td>${escapeHtml(current.step.title)}</td></tr>
<tr><td class="muted">Objective</td><td>${escapeHtml(current.step.objective ?? current.chapter.objective ?? '—')}</td></tr>
<tr><td class="muted">Files</td><td>${stepFiles(current).map((file) => `<code>${escapeHtml(file)}</code>`).join('<br>')}</td></tr>
<tr><td class="muted">Operations</td><td>${current.step.operations.length}</td></tr>
<tr><td class="muted">Pace</td><td>${escapeHtml(stepPace(current))}</td></tr>
</table>`);
    parts.push(`<h2>Afterwards</h2><p>${next ? `${escapeHtml(next.chapter.title)} · ${escapeHtml(next.step.title)}` : '<span class="muted">Final step</span>'}</p>`);
  } else {
    parts.push('<p>All steps are complete.</p>');
  }
  parts.push('<h2>Outline</h2>');
  for (const [chapterIndex, chapter] of presentation.chapters.entries()) {
    parts.push(`<div><b>${chapterIndex + 1}. ${escapeHtml(chapter.title)}</b><ul>`);
    for (const flat of steps.filter((item) => item.chapterIndex === chapterIndex)) {
      const cls = flat.index < completedSteps ? 'done' : flat.index === completedSteps ? 'current' : '';
      const mark = flat.index < completedSteps ? '✓' : flat.index === completedSteps ? '▶' : '·';
      parts.push(`<li class="${cls}">${mark} ${escapeHtml(flat.step.title)} <span class="muted">(${flat.step.operations.length} ops · ${escapeHtml(stepPace(flat))})</span></li>`);
    }
    parts.push('</ul></div>');
  }
  parts.push(`<h2>Shortcuts</h2><table>
<tr><td><kbd>Enter</kbd></td><td>Run next step (editor focused, presentation mode on)</td></tr>
<tr><td><kbd>Ctrl/Cmd+Alt+P</kbd></td><td>Pause or resume</td></tr>
<tr><td><kbd>Ctrl/Cmd+Alt+S</kbd></td><td>Skip current animation</td></tr>
<tr><td><kbd>Ctrl/Cmd+Alt+R</kbd></td><td>Restart current step</td></tr>
<tr><td><kbd>Ctrl/Cmd+Alt+Q</kbd></td><td>Exit presentation mode</td></tr>
</table></body></html>`);
  return parts.join('\n');
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] as string);
}
