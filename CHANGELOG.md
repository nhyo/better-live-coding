# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-11-17

### Added

- Configurable presentations in `.better-live-coding/presentation.json` with chapters, semantic steps and a JSON Schema
  (completion, descriptions, enum suggestions, type and path checks).
- Operation types `insertBefore`, `insertAfter`, `replace`, `delete`, `createFile`, `deleteFile`, `moveCursor`,
  `selectRange`, `openFile` and a restricted, transient-only `replaceFile`.
- Text, regex, line-restricted and line/column anchors; missing or ambiguous anchors stop the step.
- Deterministic Human Mode with fast (12–25 ms) and slow (35–60 ms) pace, automatic pace classification,
  punctuation/line/blank-line/block pauses, thinking and file-switch pauses.
- IntelliSense and parameter-hint trigger points that are shown and closed automatically.
- Multi-file, non-linear steps executed as one checkpoint transaction.
- Checkpoints: initial snapshot, per-step states, SHA-256 manifest, recognition after reload, unexpected-edit detection,
  Skip, Restart Current Step, Restart from Initial Checkpoint and Restore Checkpoint that only touch declared files.
- LF and CRLF support using line/column positions; saving without formatting.
- Commands: Initialize Presentation, Start Presentation Mode, Run Next Step, Pause or Resume, Skip Current Animation,
  Restart Current Step, Restart from Initial Checkpoint, Restore Checkpoint, Validate Presentation, Preview Steps,
  Generate Checkpoints, Generate Candidate Operations from Two Directories, Exit Presentation Mode.
- Read-only sidebar preview of the presentation.
- Candidate operation generator that compares two directories and produces a reviewable draft.
- Example: Basic TypeScript.
- Unit, headless replay and VS Code integration tests; CI on Windows and Linux; tag-based VSIX releases.

[1.0.0]: https://github.com/nhyo/better-live-coding/releases/tag/v1.0.0
