'use strict';
// Dependency-free secret scan over the files that would be committed or packaged.
// Usage: node scripts/scan-secrets.js [--vsix path/to/file.vsix]
// Exits non-zero when a likely secret, credential file, or local absolute path is found.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const zlib = require('node:zlib');

const root = path.resolve(__dirname, '..');

const CONTENT_RULES = [
  ['Vercel Blob token', /vercel_blob_rw_[A-Za-z0-9]{8,}/],
  ['GitHub token', /\b(gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/],
  ['OpenAI-style key', /\bsk-(proj-)?[A-Za-z0-9]{32,}\b/],
  ['Anthropic key', /\bsk-ant-[A-Za-z0-9-]{20,}/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['npm token', /\bnpm_[A-Za-z0-9]{36}\b/],
  ['Private key block', /-----BEGIN (RSA |EC |OPENSSH |DSA |)PRIVATE KEY-----/],
  ['JWT', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['Assigned secret value', /\b[A-Z][A-Z0-9_]*(TOKEN|SECRET|PASSWORD|API_KEY)\s*=\s*["']?[A-Za-z0-9_\-/+]{12,}/],
  ['Cookie header', /^\s*(set-)?cookie:\s*\S+=\S+/im],
  ['Windows user path', /[A-Za-z]:[\\/]+Users[\\/]+(?!runneradmin)[^\\/\s"'`]+[\\/]/i],
  ['Local desktop path', /[A-Za-z]:[\\/]+DESK[\\/]/i],
  ['Course path', /CSCI[ _-]?5117/i],
  ['POSIX home path', /\/(home|Users)\/(?!runner\b)[a-z][a-z0-9_-]+\//]
];
const FILE_RULES = [/(^|\/)\.env(\.|$)/, /\.(pem|key|p12|pfx)$/i, /(^|\/)cookies?(\.txt|\.json)?$/i, /(^|\/)\.npmrc$/, /(^|\/)\.git-credentials$/, /(^|\/)node_modules\//];
// Lines that intentionally contain sample patterns (rules above, docs, tests).
const ALLOW_FILES = new Set(['scripts/scan-secrets.js']);

function trackedFiles() {
  try {
    const output = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' });
    return output.split('\0').filter(Boolean);
  } catch {
    throw new Error('git is required to list files for scanning');
  }
}

function scanText(name, text, findings) {
  if (ALLOW_FILES.has(name)) return;
  for (const [label, pattern] of CONTENT_RULES) {
    const match = text.match(pattern);
    if (!match) continue;
    // Test fixtures deliberately use fake, obviously-invalid values.
    if (/never-read-me|vercel_blob_rw_secret|SECRET_TOKEN=abc|TOKEN=secret/.test(match[0])) continue;
    if (label === 'Windows user path' && /runneradmin/.test(match[0])) continue;
    findings.push(`${name}: ${label} → ${match[0].slice(0, 40)}${match[0].length > 40 ? '…' : ''}`);
  }
}

function scanFiles(findings) {
  const files = trackedFiles();
  for (const file of files) {
    if (FILE_RULES.some((rule) => rule.test(file)) && !/\.env\.example$/.test(file)) findings.push(`${file}: sensitive file is tracked`);
    const absolute = path.join(root, file);
    if (!fs.existsSync(absolute) || fs.statSync(absolute).size > 2_000_000) continue;
    const buffer = fs.readFileSync(absolute);
    if (buffer.includes(0)) continue;
    scanText(file, buffer.toString('utf8'), findings);
  }
  return files.length;
}

/** Minimal ZIP reader (central directory) for VSIX packages. */
function scanVsix(vsix, findings) {
  const data = fs.readFileSync(vsix);
  const end = data.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error(`${vsix} is not a zip file`);
  const count = data.readUInt16LE(end + 10);
  let offset = data.readUInt32LE(end + 16);
  const names = [];
  for (let index = 0; index < count; index += 1) {
    const method = data.readUInt16LE(offset + 10);
    const compressed = data.readUInt32LE(offset + 20);
    const nameLength = data.readUInt16LE(offset + 28);
    const extraLength = data.readUInt16LE(offset + 30);
    const commentLength = data.readUInt16LE(offset + 32);
    const local = data.readUInt32LE(offset + 42);
    const name = data.toString('utf8', offset + 46, offset + 46 + nameLength);
    names.push(name);
    const localName = data.readUInt16LE(local + 26);
    const localExtra = data.readUInt16LE(local + 28);
    const start = local + 30 + localName + localExtra;
    const raw = data.subarray(start, start + compressed);
    const content = method === 8 ? zlib.inflateRawSync(raw) : raw;
    const inner = name.replace(/^extension\//, '');
    if (FILE_RULES.some((rule) => rule.test(inner))) findings.push(`${vsix}: packaged sensitive file ${name}`);
    if (!content.includes(0)) scanText(`vsix:${name}`, content.toString('utf8'), findings);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

const findings = [];
const scanned = scanFiles(findings);
console.log(`Scanned ${scanned} repository files.`);
const vsixIndex = process.argv.indexOf('--vsix');
if (vsixIndex !== -1) {
  const names = scanVsix(path.resolve(process.argv[vsixIndex + 1]), findings);
  console.log(`Scanned ${names.length} VSIX entries.`);
  for (const forbidden of ['.env', 'node_modules/', 'examples/', 'test/', '.github/']) {
    if (names.some((name) => name.replace(/^extension\//, '').startsWith(forbidden))) findings.push(`VSIX contains ${forbidden}`);
  }
}
if (findings.length) {
  console.error(`✗ ${findings.length} potential secret(s) or local path(s):`);
  for (const finding of findings) console.error(`  ${finding}`);
  process.exitCode = 1;
} else {
  console.log('✓ No secrets, credential files or local absolute paths found.');
}
