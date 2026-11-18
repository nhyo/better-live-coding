# Contributing

Thanks for helping improve Better Live Coding!

## Setup

```bash
git clone https://github.com/nhyo/better-live-coding.git
cd better-live-coding
npm ci
npm run compile
npm test
```

Press `F5` in VS Code with the repository open to start an Extension Development Host, then open one of the folders in
`examples/` inside it.

## Checks to run before a pull request

```bash
npm test
npm run validate:schema
npm run validate:examples
npm run replay -- examples/basic-typescript --scenario
npm run replay -- examples/basic-typescript --eol=crlf
npm run scan
npm run package
```

`npm run test:integration` launches a real VS Code (set `VSCODE_EXECUTABLE` to use a local installation).

## Design rules

- **Keep the engine pure.** Nothing under `src/engine`, `src/config`, `src/checkpoints` or `src/presentation` may import
  `vscode`. VS Code specifics belong in `src/extension`.
- **No project-specific content in runtime code.** Framework names, file names and anchors belong in
  examples only; a test enforces this.
- **Never guess.** Missing or ambiguous anchors are errors. Do not add fuzzy matching.
- **Line/column, not offsets.** Positions handed to editors must work for LF and CRLF documents.
- **Determinism.** No `Math.random` or wall-clock time in pacing.
- **Privacy.** No network, no telemetry, no process spawning, no access to undeclared or sensitive files.
- **Semantic steps.** Examples should demonstrate meaningful steps, not one Enter per line.

## Changing the configuration format

Update `src/config/types.ts`, the validator in `src/config/load.ts` **and** `schemas/presentation.schema.json`
together, add tests in `test/config.test.ts`, and document the field in `docs/configuration.md` and both READMEs.

## Commits and pull requests

Write short, descriptive commit messages in the imperative mood ("Add regex anchors"). Keep pull requests focused and
describe how you tested them. Do not add trailers or attribution lines to commit messages.

## Releases

1. Update `version` in `package.json` and add a `CHANGELOG.md` entry.
2. Commit, then tag `vX.Y.Z` and push the tag.
3. The `Release` workflow runs the full test matrix and, only if it passes, attaches the VSIX to a GitHub release.
