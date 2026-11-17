'use strict';
// Runs the full "Validate Presentation" pipeline (schema rules, paths, anchors,
// dry run of every step, final-directory comparison) on every example.
// Usage: node scripts/validate-examples.js [example-folder ...]
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const { validateProject, formatDiagnostic } = require(path.join(root, 'out', 'src', 'presentation', 'project.js'));

async function main() {
  const requested = process.argv.slice(2);
  const folders = requested.length
    ? requested.map((item) => path.resolve(item))
    : fs
        .readdirSync(path.join(root, 'examples'), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(root, 'examples', entry.name));
  let failed = 0;
  for (const folder of folders) {
    const report = await validateProject(folder);
    const name = path.relative(root, folder).replace(/\\/g, '/') || folder;
    const ok = report.errors === 0 && report.finalVerified !== false;
    console.log(
      `${ok ? '✓' : '✗'} ${name}: ${report.chapters} chapters, ${report.steps} steps, ${report.files.length} files, ` +
        `${report.errors} errors, ${report.warnings} warnings, final ${report.finalVerified === undefined ? 'not configured' : report.finalVerified ? 'matches' : 'DIFFERS'}`
    );
    for (const item of report.diagnostics) console.log(`    ${formatDiagnostic(item).replace(/\n/g, '\n    ')}`);
    if (!ok) failed += 1;
  }
  process.exitCode = failed ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
