# Example: Vercel Blob tech share

A sanitised version of a real classroom talk: a SvelteKit page that selects, uploads, lists and deletes files in
Vercel Blob. Only the two files that are edited live are included; there are no credentials, no `.env` files and no
assets.

| Folder | Purpose |
| --- | --- |
| `.better-live-coding/presentation.json` | 4 chapters, 15 semantic steps. |
| `initial/src/routes/` | Starting `+page.svelte` (with TODO markers) and an empty `api/blob/+server.ts` outline (CRLF). |
| `final/src/routes/` | The finished files (CRLF). |
| `practice/` | Working copy, created on demand by *Start Presentation Mode* (git-ignored). |

What it demonstrates:

- **Semantic steps**: "define selection state", "create the Upload button", "implement uploadImage", "implement the
  upload backend" … rather than one Enter per line.
- **Non-linear frontend ↔ backend switching**: the Upload button is written before `uploadImage`, then the POST
  endpoint in `+server.ts`, then back to the page for feedback and preview; the same pattern repeats for the gallery
  (GET) and delete (DELETE) features.
- **Fast and slow pace chosen automatically**: imports, functions and endpoints are slow; state, types, HTML and CSS are
  fast (the automatic classification matches the hand-tuned original exactly).
- **IntelliSense trigger points**: `request.`, `Response.`, `blob.` and parameter hints for `handleUpload(`.
- **CRLF** files throughout.

To run the actual app you need your own SvelteKit project, the `@vercel/blob` package and a Blob read-write token in
`.env.local`; Better Live Coding never reads that file. To rehearse the typing alone, nothing else is required — open
this folder in VS Code and run **Start Presentation Mode**.

Headless replay from the repository root:

```bash
npm run compile && node scripts/replay-example.js examples/vercel-blob --scenario
```
