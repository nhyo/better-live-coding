# Architecture

```
            ┌──────────────────────── src/extension (VS Code only) ────────────────────────┐
 commands → │ Controller ── dialogs, status bar, context keys, preview webview              │
            │     │                                                                         │
            │ VscodeHost implements EditorHost (TextEditor.edit, selections, reveal,        │
            │     │      save without formatting, suggest / parameter hints, own-edit        │
            │     │      suppression)                                                        │
            └─────┼─────────────────────────────────────────────────────────────────────────┘
                  ▼
 src/presentation  PresentationSession ── StepStateMachine + StepRunner + CheckpointSet
                   project.ts (load + validate), preview.ts, candidates.ts, template.ts
 src/engine        anchors.ts → operations.ts (pure planning) → runner.ts (animation on an EditorHost)
                   pacing.ts (deterministic Human Mode), stateMachine.ts, suppressor.ts, host.ts
 src/checkpoints   checkpoints.ts (build / identify / manifest), fileStore.ts (safe fs), generate.ts
 src/config        types.ts, load.ts (validator mirroring the JSON Schema)
 src/utilities     text.ts (EOL, positions, deterministic hash), paths.ts (path safety)
 src/testing       MemoryHost, DiskHost, VirtualClock (unit tests and headless replay)
```

## Flow of one Enter

1. The `enter` keybinding (only when `betterLiveCoding.presentationMode && editorTextFocus && !terminalFocus`) runs
   `betterLiveCoding.nextStep`.
2. `PresentationSession.next()` calls `StepStateMachine.beginNext()` **synchronously**; a second Enter returns
   `ignored` before any `await`.
3. The declared files are read and compared with the step's start checkpoint. Any difference stops the step and is
   reported (`unexpected-changes`).
4. `StepRunner` plans each operation on the *expected* file set with `planOperation` (the same function that builds
   checkpoints), verifies the real document equals the plan's `before` text, converts offsets to line/column and
   animates: switch file → reveal → select / place cursor → think → delete → type character by character → close
   widgets → save without formatting.
5. Between every character the runner checks pause/skip/abort. Pause blocks without typing; skip/abort unwind.
6. After the step, the files are compared with the end checkpoint. Skip writes the end checkpoint; abort writes the
   start checkpoint. The state machine advances only when the end checkpoint is verified.

## Why the engine never touches offsets in CRLF documents

All matching is done on LF-normalised text. A normalised offset is converted to `{ line, character }`, which is
identical in LF and CRLF documents. Inserted line breaks use the document's EOL. Tests demonstrate that using a
normalised offset directly in CRLF text lands in the wrong place.

## Own edits vs. external edits

`EditSuppressor` marks a file while the extension edits it and remembers the document version produced by its last
edit. Change events for that file with a version up to that number are ours; anything newer is external and is shown
in the status bar. Correctness never depends on the event stream: before and after every step the actual content is
compared with the checkpoints.

## Checkpoints

`buildCheckpoints` applies each step to the previous state, producing `states[0..N]`. They are kept in memory and can
be recomputed at any time from checkpoint 0 and the configuration. `manifest.json` stores SHA-256 hashes so that the
current position can be recognised without rebuilding, and so that a changed configuration is detected.
