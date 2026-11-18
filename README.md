# Better Live Coding

**English** · [简体中文](README.zh-CN.md)

Better Live Coding turns any project into a **deterministic, rehearsable live-coding presentation inside VS Code**.
You describe chapters and *semantic steps* in a JSON file; while presenting, every **Enter** types the next step into
real editors — with syntax highlighting, diagnostics, IntelliSense and parameter hints — across as many files as you
need, in the order a real developer would write them. Checkpoints let you skip, restart and recover at any moment.

It is technology-independent: no framework or file layout is built into the extension.

## Features

- **Semantic steps** – one Enter = one meaningful unit (a state group, a UI block, a function, an endpoint), even when
  it touches several files. Chapters and steps show as `Stage 2 · Step 3/6`.
- **Ten operation types** – `insertBefore`, `insertAfter`, `replace`, `delete`, `createFile`, `deleteFile`,
  `moveCursor`, `selectRange`, `openFile`, plus a restricted `replaceFile` for declared instant changes.
- **Strict anchors** – text, regex or line/column. A missing or ambiguous anchor stops the step with an actionable
  error; the engine never guesses a position.
- **Deterministic Human Mode** – per-character variation, punctuation/line/blank-line/block pauses, thinking pauses
  and file-switch pauses. The same configuration produces the same rhythm in every rehearsal.
- **Fast and slow pace** – 12–25 ms/char for state, types, HTML and CSS; 35–60 ms/char for imports, functions and
  endpoints. Chosen automatically or set per step/operation.
- **Native VS Code effects** – IntelliSense after `request.`, parameter hints after `handleUpload(`, selections before
  replacements, auto-scroll, cursor placement; widgets close before typing continues.
- **Non-linear order** – write the button before its handler, jump to the backend and come back.
- **Checkpoints** – initial state plus one checkpoint per step, recognised after a crash or reload; Skip, Restart and
  Restore write only declared files.
- **Validation** – schema rules, unique ids, path safety, anchor existence and uniqueness, a full dry run of every step
  and comparison with an expected final directory.
- **Candidate diff generator** – proposes anchored operations between two directories as a *draft* you organise into
  semantic steps yourself.
- **Private by design** – no network, no telemetry, never reads `.env*`, credentials or undeclared files.

## Installation

Download `better-live-coding-1.0.0.vsix` from the
[latest release](https://github.com/nhyo/better-live-coding/releases/latest), then:

```bash
code --install-extension better-live-coding-1.0.0.vsix
```

or use *Extensions → … → Install from VSIX…*. Requires VS Code 1.90 or newer.

## Quick start (3 minutes)

1. Open your project folder in VS Code.
2. Run **Better Live Coding: Initialize Presentation**. It creates `.better-live-coding/` with a runnable starter
   presentation, the JSON Schema and a short README. Existing files are never overwritten.
3. Edit `.better-live-coding/presentation.json`: set `workspace.workingDirectory` and replace the starter chapter with
   your own steps (completion and hover docs come from the schema).
4. Put the files into their starting state and run **Better Live Coding: Generate Checkpoints**
   (or point `workspace.initialDirectory` at a pristine copy).
5. Run **Better Live Coding: Validate Presentation** until it reports 0 errors.
6. Run **Better Live Coding: Start Presentation Mode**, click into an editor and press **Enter**.

To try it without writing anything, open [`examples/basic-typescript`](examples/basic-typescript) as a folder and run
*Start Presentation Mode*; it offers to create the `practice/` working copy from `initial/`.

## Configuration format

```jsonc
{
  "$schema": "./presentation.schema.json",
  "version": 1,
  "title": "My Live Coding Demo",
  "workspace": {
    "workingDirectory": "practice",   // where typing happens (relative to the workspace folder)
    "initialDirectory": "starter",    // optional pristine start state
    "finalDirectory": "solution",     // optional expected end state (validation)
    "newFileEol": "lf"                // line ending for createFile
  },
  "humanMode": { "enabled": true, "seed": "my-presentation" },
  "chapters": [
    {
      "id": "upload",
      "title": "Upload a file",
      "steps": [
        {
          "id": "upload-function",
          "title": "Implement upload function",
          "objective": "Upload a selected file and display the returned URL",
          "operations": [
            {
              "type": "insertBefore",
              "file": "src/app.ts",
              "anchor": { "text": "// upload" },
              "pace": "slow",
              "effects": { "suggestAfter": ["response."] },
              "text": [
                "async function upload(file: File) {",
                "  const response = await fetch('/api/upload', { method: 'POST', body: file });",
                "  url = (await response.json()).url;",
                "}",
                ""
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

Every `file` is relative to `workspace.workingDirectory`; absolute paths, `..` segments and sensitive paths
(`.env*`, keys, `node_modules`, `.git`, …) are rejected. The full reference is in
[docs/configuration.md](docs/configuration.md).

### Operation fields

| Field | Meaning |
| --- | --- |
| `type` | One of the ten operation types. |
| `file` | Target file (relative). |
| `anchor` | `{ "text" }`, `{ "regex", "flags" }`, `{ "line", "column" }`, `{ "line", "column", "endLine", "endColumn" }`, or `text`/`regex` restricted to a `line`. |
| `text` | String, or array of lines joined with `\n` (typed with the document's own EOL). |
| `expectBefore` / `expectAfter` | Text that must exist before/after the operation. |
| `pace` | `fast`, `slow` or `auto` (default). |
| `thinking` | Shown as `Thinking · …` while the location is revealed. |
| `effects` | `auto`, `suggestAfter`, `parameterHintsAfter`. |
| `scroll` | `center`, `centerIfOutside` (default), `top`, `minimal`, `none`. |
| `cursor` | `start`/`end` for `moveCursor`. |
| `transient` | Required (`true`) for `replaceFile`. |

## JSON Schema

`schemas/presentation.schema.json` ships with the extension and is associated automatically with every
`.better-live-coding/presentation.json` (completion, descriptions, enum suggestions, type and path-format checks,
missing-field warnings). *Initialize Presentation* also copies it next to your configuration so that it works in other
editors.

## Semantic steps

A step is a **unit a viewer can name**: "define the selection state", "create the Upload button", "implement the POST
endpoint". Group the operations that make up that unit — even across files — into one step. Do **not** split a
function head from its body, a button's tags from its label, or an endpoint's validation from its return value just
to get more Enter presses. All operations of a step run as one checkpoint transaction: if any of them cannot run, the
step stops and nothing is guessed.

## Human Mode

Human Mode is on by default and is fully deterministic (a hash of seed, step, operation and character — no
`Math.random`). It adds punctuation, line, blank-line and block-end pauses, a pause after switching files, and a
*thinking* pause after the edit location is revealed (status bar: `Thinking · Implement upload function`). Before a
replacement the old text is selected; before an insertion the cursor is placed; after the step the cursor stays at the
end of the typed code. No deliberate typos are ever introduced. Turn it off with `betterLiveCoding.humanMode: false` or
`"humanMode": { "enabled": false }` to type at `betterLiveCoding.fixedTypingDelayMs`.

### Fast and slow pace

| Pace | Default | Used for |
| --- | --- | --- |
| fast | `betterLiveCoding.fastTypingDelayMinMs` 12 – `fastTypingDelayMaxMs` 25 ms/char | state, types, HTML, CSS, simple UI, plain objects |
| slow | `betterLiveCoding.slowTypingDelayMinMs` 35 – `slowTypingDelayMaxMs` 60 ms/char | imports, complete functions, GET/POST/DELETE endpoints, core logic |

With `"pace": "auto"` (the default) imports, function definitions and endpoint definitions are slow and everything else
is fast. Set `pace` on a step or an operation to override.

## Native VS Code hints

While typing, the extension calls `editor.action.triggerSuggest` after `identifier.` and
`editor.action.triggerParameterHints` after `identifier(`; add more trigger points with `effects.suggestAfter` (e.g.
`"request."`, `"Resp"`) and `effects.parameterHintsAfter`. Suggestions are only *shown* — the typed text never depends
on what your language server proposes — and they are closed before typing continues and before the step completes.
Disable with `betterLiveCoding.editorEffects: false` or `"effects": { "auto": false }`.

## Commands

| Command | Default key |
| --- | --- |
| Better Live Coding: Initialize Presentation | |
| Better Live Coding: Start Presentation Mode | |
| Better Live Coding: Run Next Step | `Enter` (presentation mode, editor focused) |
| Better Live Coding: Pause or Resume | `Ctrl+Alt+P` / `Cmd+Alt+P` |
| Better Live Coding: Skip Current Animation | `Ctrl+Alt+S` / `Cmd+Alt+S` |
| Better Live Coding: Restart Current Step | `Ctrl+Alt+R` / `Cmd+Alt+R` |
| Better Live Coding: Restart from Initial Checkpoint | |
| Better Live Coding: Restore Checkpoint | |
| Better Live Coding: Validate Presentation | |
| Better Live Coding: Preview Steps | |
| Better Live Coding: Generate Checkpoints | |
| Better Live Coding: Generate Candidate Operations from Two Directories | |
| Better Live Coding: Exit Presentation Mode | `Ctrl+Alt+Q` / `Cmd+Alt+Q` |

**Enter** is bound only while presentation mode is on *and* a text editor has focus; it never fires in the terminal,
in the suggest widget, rename box or find widget. While a step runs, further Enter presses are swallowed and ignored.
After *Exit Presentation Mode* Enter behaves normally again. Clicking the status bar item also runs the next step.

## Checkpoints and recovery

- **Checkpoint 0** is the initial state (from `workspace.initialDirectory` or
  `.better-live-coding/checkpoints/initial.json`); checkpoint *N* is the state after step *N*.
- `checkpoints/manifest.json` stores SHA-256 hashes (line endings normalised) of every checkpoint.
- On start, the current files are matched against all checkpoints. After a crash or *Reload Window* mid-step, no
  checkpoint matches; the extension proposes the last saved one and lists exactly which files it will rewrite.
- Before each step the files are compared with the expected start checkpoint; unexpected edits are reported and you
  choose whether to restore.
- **Skip** writes the complete end checkpoint of the running step. **Restart Current Step** rolls back to the step's
  start and runs it again. **Restore Checkpoint** / **Restart from Initial Checkpoint** show the files to be changed
  first.
- Only declared files (operation targets and `workspace.files`) are ever written. `.env*`, credentials, dependency
  folders and anything undeclared are never read or modified.
- Saves use *Save without Formatting*, so format-on-save, trim-whitespace and final-newline participants cannot change a
  checkpoint. Both LF and CRLF files are supported; positions are always line/column, never raw offsets.

## Preview panel

**Preview Steps** opens the *Better Live Coding* view in its own activity-bar container (never over the editor). It is
read-only and shows the title, current chapter and step, objective, files involved, operation count, pace, the step
after, the current checkpoint, the outline and the shortcuts.

## Candidate operations

**Generate Candidate Operations from Two Directories** compares a start and an end directory and writes
`.better-live-coding/candidates.json`: created/deleted files and anchored insert/replace/delete operations, grouped by
heuristic category (state/markup/style, function, import, endpoint, removal) and file. The result is explicitly a
**draft** — it never turns each changed line into a step and never decides the teaching order. Merge candidates into
semantic steps and order them yourself.

## Examples

| Example | Shows |
| --- | --- |
| [`examples/basic-typescript`](examples/basic-typescript) | variables, functions, multiple files, a created and a deleted file, error handling added last, a CRLF file, Human Mode, checkpoint restore |

## FAQ

**Enter inserts a newline instead of running a step.** Presentation mode is off, the editor does not have focus, or a
suggest/rename/find widget is open. Click into the editor or the status bar item.

**"Anchor is not unique".** Extend the anchor text, add `"line"`, or use a regex. The engine refuses to guess.

**"The presentation files do not match any checkpoint".** Someone edited a declared file, or a step was interrupted.
Accept the proposed restore (the dialog lists every file it rewrites) or use *Restore Checkpoint*.

**Can I keep the timing but make it faster?** Lower the `betterLiveCoding.*` delays; the rhythm stays deterministic.

**Does it work with any language?** Yes. It edits text; language features come from whatever extensions you have.

## Development

```bash
npm ci
npm run compile
npm test                      # unit tests (node:test)
npm run validate:schema       # Ajv strict compile + examples against the schema
npm run validate:examples     # full Validate Presentation on every example
npm run replay -- examples/basic-typescript --scenario   # headless full replay with Human Mode timing
npm run test:integration      # real VS Code extension host (downloads VS Code unless VSCODE_EXECUTABLE is set)
npm run scan                  # secret / local-path scan
npm run package               # build the VSIX
```

## Testing

The unit suite covers configuration parsing, the JSON Schema, invalid JSON, missing fields, duplicate ids, path
escapes, missing and ambiguous anchors, every operation type, multi-operation transactions, non-linear file order, the
state machine, double-Enter protection, pause/resume, skip, restart, checkpoint restore, unexpected-modification
detection, LF/CRLF, save-without-formatting, own-edit suppression, deterministic Human Mode, both paces and their
automatic classification, final-directory validation, untouched undeclared files and `.env.local` isolation. The
integration suite drives both examples end-to-end in a real VS Code with aggressive save participants enabled. CI runs
everything on Windows and Linux.

## Architecture

```
src/
├── config/        presentation model + dependency-free validator (mirrors the JSON Schema)
├── engine/        anchors, pure operation planning, pacing, state machine, step runner, host interface
├── checkpoints/   checkpoint building/identification/manifest, safe file access, generation
├── presentation/  session orchestration, project loading + validation, preview model, candidate diff, init template
├── extension/     VS Code adapter: host implementation, controller (commands/UI), preview webview
├── testing/       in-memory and disk editor hosts + virtual clock (tests and headless replay)
└── utilities/     text/EOL/position helpers, path safety
```

The engine never imports `vscode`; the same code runs in tests, in headless replays and in the extension. See
[docs/architecture.md](docs/architecture.md).

## Privacy

Better Live Coding works offline. It has no telemetry, makes no network requests, does not upload or share source code,
does not run shell commands, never reads `.env*` files or credentials, never reads or writes files that the
presentation does not declare, never logs environment variables, and rejects paths that escape the workspace. See
[SECURITY.md](SECURITY.md).

## Known limitations

- Typing goes through `TextEditor.edit`, so editor auto-closing brackets, auto-indent and snippet expansion do not run
  (the result is exactly the configured text).
- Language-server diagnostics may flicker while code is half typed; that is real editor behaviour.
- IntelliSense content depends on the user's language extensions; it is shown but never relied on.
- Files can only be edited inside the first workspace folder that contains the presentation; multi-root presentations
  spanning several folders are not supported.
- Binary files are not supported as presentation files.
- The keyboard shortcuts `Ctrl+Alt+P/S/R/Q` may collide with other extensions; rebind them in Keyboard Shortcuts.

## License

[MIT](LICENSE)
