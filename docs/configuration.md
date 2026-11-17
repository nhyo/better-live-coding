# Configuration reference

The presentation lives in `.better-live-coding/presentation.json` (change the location with the
`betterLiveCoding.presentationFile` setting). It is validated by `schemas/presentation.schema.json` and by the
extension's own validator, which reports the chapter, step and file of every problem.

## Top level

| Field | Required | Description |
| --- | --- | --- |
| `$schema` | no | `./presentation.schema.json` after *Initialize Presentation*. |
| `version` | yes | Always `1`. |
| `title` | yes | Shown in the preview panel. |
| `description` | no | Free text. |
| `workspace` | no | See below. |
| `humanMode` | no | `{ "enabled": true, "seed": "..." }`. |
| `chapters` | yes | Non-empty array of chapters. |

## `workspace`

| Field | Default | Description |
| --- | --- | --- |
| `workingDirectory` | `.` | Directory, relative to the workspace folder, in which files are typed. |
| `initialDirectory` | – | Pristine copy of the starting files. When set it is the source of checkpoint 0, and *Start* offers to create a missing working directory from it. |
| `finalDirectory` | – | Expected final files. *Validate Presentation* compares the last checkpoint with it. |
| `files` | `[]` | Extra declared files (relative to the working directory). Declared files = every operation `file` + this list. Only declared files are ever checkpointed or written. |
| `newFileEol` | `lf` | Line ending of files created by `createFile`. |

If neither `initialDirectory` nor `.better-live-coding/checkpoints/initial.json` exists, the current working directory
is treated as the starting state and a warning asks you to run *Generate Checkpoints*.

## Chapters and steps

```json
{ "id": "upload", "title": "Upload a file", "objective": "...", "steps": [ ... ] }
{ "id": "upload-function", "title": "Implement upload function", "objective": "...", "pace": "auto", "thinking": "...", "operations": [ ... ] }
```

- Ids use letters, digits, `.`, `_` and `-`. Chapter ids are unique; step ids are unique across the presentation.
- `objective` appears in the preview and the status-bar tooltip.
- `thinking` defaults to the step title and is shown as `Thinking · …` before typing.
- `pace` on a step applies to all its operations unless an operation sets its own.

## Operations

| Type | Needs | Effect |
| --- | --- | --- |
| `insertBefore` | `anchor`, `text` | Places the cursor at the start of the anchor and types `text`. |
| `insertAfter` | `anchor`, `text` | Places the cursor at the end of the anchor and types `text`. |
| `replace` | `anchor`, `text` | Selects the anchor, removes it, types `text`. |
| `delete` | `anchor` | Selects the anchor and removes it. |
| `createFile` | `text` (optional) | Creates an empty file (it must not exist), opens it, types `text`. |
| `deleteFile` | – | Deletes the file (it must exist). |
| `moveCursor` | `anchor` | Moves the cursor to the anchor start (`"cursor": "end"` for the end). |
| `selectRange` | `anchor` | Selects the anchor. |
| `openFile` | optional `anchor` | Opens the file and optionally reveals/selects the anchor. |
| `replaceFile` | `text`, `"transient": true` | Instantly replaces the file. Intended for restore helpers; never use it for normal animation. |

### Anchors

| Form | Meaning |
| --- | --- |
| `{ "text": "</script>" }` | Literal text that must occur exactly once in the file. |
| `{ "text": "= 0;", "line": 2 }` | Literal text that must occur exactly once on line 2. |
| `{ "regex": "^\\}\\n", "flags": "m" }` | Regular expression that must match exactly once (`i`, `m`, `s`, `u` flags). |
| `{ "line": 3, "column": 5 }` | A position (1-based). |
| `{ "line": 3, "column": 1, "endLine": 5, "endColumn": 2 }` | A range (1-based). |

Anchors are resolved against the file *as it is at that point of the presentation*, after all earlier operations.
Line endings are normalised for matching, and positions are converted to line/column before they reach the editor, so
the same configuration works for LF and CRLF files.

### Text

`text` may be a string or an array of lines that is joined with `\n`. The editor receives the document's own line
ending. Indentation is typed exactly as written (editor auto-indent and auto-closing do not apply).

### Guards

`expectBefore` and `expectAfter` are substrings that must be present before/after the operation. Use them to document
assumptions; validation fails with the step and file when they do not hold.

### Effects

```json
"effects": { "auto": true, "suggestAfter": ["request.", "Resp"], "parameterHintsAfter": ["handleUpload("] }
```

`auto` triggers IntelliSense after `identifier.` (when another identifier character follows) and parameter hints after
`identifier(`. `suggestAfter` / `parameterHintsAfter` add explicit trigger points: when the typed text of the operation
ends with one of the strings, the widget opens for `betterLiveCoding.suggestionVisibleMs` and then closes.

### Scrolling

`scroll` controls how the editor reveals the edit: `centerIfOutside` (default), `center`, `top`, `minimal` or `none`.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `betterLiveCoding.presentationFile` | `.better-live-coding/presentation.json` | Location of the presentation. |
| `betterLiveCoding.humanMode` | `true` | Deterministic human rhythm. |
| `betterLiveCoding.fixedTypingDelayMs` | `28` | Delay per character with Human Mode off. |
| `betterLiveCoding.fastTypingDelayMinMs` / `MaxMs` | `12` / `25` | Fast pace range. |
| `betterLiveCoding.slowTypingDelayMinMs` / `MaxMs` | `35` / `60` | Slow pace range. |
| `betterLiveCoding.punctuationPauseMs` | `90` | Extra pause after `.,;:)}]>` (×0.25 for fast pace). |
| `betterLiveCoding.linePauseMs` | `180` | Extra pause after a line break (×0.3 for fast pace). |
| `betterLiveCoding.blankLinePauseMs` | `550` | Extra pause after a blank line (×0.3 for fast pace). |
| `betterLiveCoding.blockEndPauseMs` | `400` | Pause after closing blocks and after each operation. |
| `betterLiveCoding.fileSwitchPauseMs` | `700` | Pause after switching files. |
| `betterLiveCoding.thinkingPauseMs` | `500` | Pause after revealing the edit location (×0.4 for fast pace). |
| `betterLiveCoding.suggestionVisibleMs` | `420` | How long IntelliSense / hints stay visible. |
| `betterLiveCoding.editorEffects` | `true` | Enable IntelliSense / parameter hint triggers. |

## Files written by the extension

| File | Written by |
| --- | --- |
| `.better-live-coding/presentation.json`, `presentation.schema.json`, `README.md` | *Initialize Presentation* (never overwrites). |
| `.better-live-coding/checkpoints/initial.json` | *Generate Checkpoints* when you choose to capture the working directory. |
| `.better-live-coding/checkpoints/manifest.json` | *Generate Checkpoints*. |
| `.better-live-coding/candidates.json` | *Generate Candidate Operations*. |
| Declared files in the working directory | Steps, Skip, Restart, Restore. |
