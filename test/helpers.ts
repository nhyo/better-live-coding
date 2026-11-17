import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Presentation } from '../src/config/types';
import { buildCheckpoints } from '../src/checkpoints/checkpoints';
import { DEFAULT_PACING, PacingSettings } from '../src/engine/pacing';
import { PresentationSession, SavedSession, SessionStore } from '../src/presentation/session';
import { MemoryHost, VirtualClock } from '../src/testing/hosts';
import { detectEol, normalizeEol } from '../src/utilities/text';

export const ROOT = path.resolve(__dirname, '..', '..');

export function presentation(chapters: Presentation['chapters'], extra: Partial<Presentation> = {}): Presentation {
  return { version: 1, title: 'Test', humanMode: { seed: 'test' }, chapters, ...extra };
}

/** Two-file fixture used by many tests: a page and a server file. */
export const PAGE_START = ['<script>', '</script>', '', '<main>', '  <!-- ui -->', '</main>', ''].join('\n');
export const SERVER_START = ['// imports', '', '// endpoint', ''].join('\n');

export function nonLinearPresentation(): Presentation {
  return presentation([
    {
      id: 'upload',
      title: 'Upload',
      steps: [
        {
          id: 'state',
          title: 'Define state',
          operations: [
            { type: 'insertAfter', file: 'page.svelte', anchor: { text: '<script>' }, text: "\n  let file = $state(null);\n  let error = $state('');" }
          ]
        },
        {
          id: 'button',
          title: 'Create the button',
          operations: [{ type: 'replace', file: 'page.svelte', anchor: { text: '  <!-- ui -->' }, text: '  <button onclick={upload}>Upload</button>' }]
        },
        {
          id: 'function',
          title: 'Implement upload()',
          operations: [
            {
              type: 'insertBefore',
              file: 'page.svelte',
              anchor: { text: '</script>' },
              text: "  async function upload() {\n    await fetch('/api', { method: 'POST' });\n  }\n"
            }
          ]
        },
        {
          id: 'backend',
          title: 'Implement the endpoint',
          operations: [
            { type: 'replace', file: 'server.ts', anchor: { text: '// imports' }, text: "import { json } from './json';" },
            {
              type: 'replace',
              file: 'server.ts',
              anchor: { text: '// endpoint' },
              text: 'export const POST = async ({ request }) => {\n  return json(await request.json());\n};'
            }
          ]
        },
        {
          id: 'feedback',
          title: 'Show errors',
          operations: [
            { type: 'insertAfter', file: 'page.svelte', anchor: { text: '<button onclick={upload}>Upload</button>' }, text: '\n  {#if error}<p>{error}</p>{/if}' }
          ]
        }
      ]
    }
  ]);
}

export const FAST_TEST_PACING: PacingSettings = { ...DEFAULT_PACING };

export class MemoryStore implements SessionStore {
  value: SavedSession | undefined;
  async load() {
    return this.value;
  }
  async save(session: SavedSession) {
    this.value = session;
  }
}

export function makeSession(
  definition: Presentation,
  files: Record<string, string>,
  options: { settings?: PacingSettings; host?: MemoryHost; clock?: VirtualClock; store?: MemoryStore } = {}
) {
  const clock = options.clock ?? new VirtualClock();
  const host = options.host ?? new MemoryHost(files, clock);
  const initial: Record<string, string | null> = {};
  const eol: Record<string, 'lf' | 'crlf'> = {};
  for (const [file, text] of Object.entries(files)) {
    initial[file] = normalizeEol(text);
    eol[file] = detectEol(text);
  }
  const checkpoints = buildCheckpoints(definition, initial, eol, definition.workspace?.newFileEol ?? 'lf');
  const store = options.store ?? new MemoryStore();
  const session = new PresentationSession({
    presentation: definition,
    checkpoints,
    host,
    clock,
    settings: options.settings ?? FAST_TEST_PACING,
    store
  });
  return { session, host, clock, checkpoints, store };
}

export function tempDir(prefix = 'blc-test-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function writeTree(base: string, files: Record<string, string>): void {
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(base, file)), { recursive: true });
    fs.writeFileSync(path.join(base, file), text);
  }
}

export function readTree(base: string, relative = ''): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entry of fs.readdirSync(path.join(base, relative), { withFileTypes: true })) {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(result, readTree(base, child));
    else result[child] = fs.readFileSync(path.join(base, child), 'utf8');
  }
  return result;
}
