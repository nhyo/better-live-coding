# Example: Basic TypeScript cart

A small, dependency-free TypeScript project presented in 3 chapters and 8 semantic steps.

| Folder | Purpose |
| --- | --- |
| `.better-live-coding/presentation.json` | The presentation. |
| `initial/` | Starting files (checkpoint 0). `src/crlf/legacy.ts` uses Windows line endings. |
| `final/` | Expected result; *Validate Presentation* compares against it. |
| `practice/` | Working copy, created on demand by *Start Presentation Mode* (git-ignored). |

What it demonstrates:

- **State** (`cart-state`, fast pace) and **complete functions** (`add-item`, `total`, slow pace).
- **Multiple files and non-linear order**: the calling code in `main.ts` is written first, then a new `receipt.ts` is
  created and the step returns to `main.ts`; validation is added to `cart.ts` *last*, then handled in `main.ts`.
- **Delete / deleteFile / selectRange / moveCursor / openFile** operations.
- **CRLF**: the `legacy-discount` step edits a CRLF file and keeps its line endings.
- **Human Mode** and **IntelliSense / parameter hints** (`items.`, `formatPrice(`, `console.`).
- **Checkpoint restore**: use *Restore Checkpoint* at any time; only the five declared files are rewritten.

Try it: open this folder in VS Code, run **Better Live Coding: Start Presentation Mode**, accept creating `practice/`,
click into an editor and press **Enter**. The final program prints:

```
Invalid quantity for Broken
Total....... $9.18
```

Headless replay from the repository root:

```bash
npm run compile && node scripts/replay-example.js examples/basic-typescript --scenario
```
