# Security and privacy

## What Better Live Coding does and does not do

| Behaviour | Status |
| --- | --- |
| Network access | **None.** The extension makes no HTTP requests and opens no sockets. |
| Telemetry | **None.** Nothing is collected or sent anywhere. |
| Source code upload / third-party services | **Never.** |
| Shell commands | **Never.** Presentation files cannot declare commands; the extension does not spawn processes. |
| Reading files | Only `.better-live-coding/*`, the declared presentation files inside the working directory, and the optional `initialDirectory` / `finalDirectory`. |
| Writing files | Only declared presentation files inside the working directory, plus `.better-live-coding/checkpoints/*` and `candidates.json` when you run those commands. |
| `.env`, `.env.*`, keys, `.npmrc`, `.netrc`, credential/cookie/token files | Never read, written, copied or packaged; configurations that reference them are rejected. |
| `node_modules`, `.git` and other VCS / build-cache folders | Never read or written. |
| Paths outside the workspace | Rejected: absolute paths, drive letters, UNC paths, `..` segments and symlinks resolving outside the base directory. |
| Logs | The output channel contains step ids, file names and error messages only — never file contents of undeclared files or environment variables. |
| Checkpoint files | Contain relative paths and the content of declared files only; never absolute paths, tokens, cookies or environment files. |

Before any restore, the list of files that will be rewritten is shown. Files that are not declared are never modified.

The preview panel is a static webview: scripts are disabled and a strict Content-Security-Policy is applied.

## Your responsibility

Presentation files and checkpoints contain the code you present. Do not put secrets into declared files or into
`presentation.json`. Keep credentials in `.env*` files (which the extension ignores) and out of version control.

## Reporting a vulnerability

Please report security issues privately through GitHub's
[private vulnerability reporting](https://github.com/nhyo/better-live-coding/security/advisories/new) instead of
opening a public issue. Include the version, steps to reproduce and the impact. You will receive an acknowledgement
as soon as possible; fixes are released as patch versions and described in the changelog.

## Supported versions

Only the latest released version receives security fixes.
