/**
 * Path safety rules. Every path in a presentation is a workspace-relative,
 * forward-slash path. Nothing may escape the workspace, and sensitive files
 * (environment files, credentials, dependency folders, VCS metadata) can never
 * be declared as presentation files.
 */

export class PathError extends Error {}

const SENSITIVE_SEGMENTS = new Set([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  '.vercel',
  '.netlify',
  '.aws',
  '.ssh',
  '.gnupg',
  '.svelte-kit',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache'
]);

const SENSITIVE_FILE_PATTERNS: RegExp[] = [
  /^\.env(\..*)?$/i,
  /^\.npmrc$/i,
  /^\.pypirc$/i,
  /^\.netrc$/i,
  /^\.git-credentials$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /\.(pem|key|p12|pfx|keystore|jks)$/i,
  /^credentials(\.json)?$/i,
  /^cookies?(\.txt|\.json)?$/i,
  /^secrets?(\..*)?$/i,
  /^\.?(access[-_]?)?tokens?(\.(txt|json))?$/i
];

/** True when a relative path points at something that must never be touched. */
export function isSensitivePath(relativePath: string): boolean {
  const segments = relativePath.split('/').filter(Boolean);
  if (segments.some((segment) => SENSITIVE_SEGMENTS.has(segment.toLowerCase()))) return true;
  const name = segments[segments.length - 1] ?? '';
  // Allow ordinary example templates such as `.env.example` to be *read-only
  // ignored* but still never declared: they are environment files too.
  return SENSITIVE_FILE_PATTERNS.some((pattern) => pattern.test(name));
}

/**
 * Validates and normalizes a workspace-relative path.
 * Rejects absolute paths, drive letters, UNC paths, `..` segments, and empty
 * segments. Returns the normalized forward-slash form.
 */
export function normalizeRelativePath(input: string, label = 'path'): string {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new PathError(`${label} must be a non-empty relative path.`);
  }
  const value = input.replace(/\\/g, '/');
  if (value.startsWith('/') || /^[a-zA-Z]:/.test(value) || value.startsWith('//')) {
    throw new PathError(`${label} "${input}" must be relative to the workspace, not absolute.`);
  }
  if (/[\u0000-\u001f<>"|?*]/.test(value)) {
    throw new PathError(`${label} "${input}" contains characters that are not allowed in paths.`);
  }
  const segments: string[] = [];
  for (const segment of value.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      throw new PathError(`${label} "${input}" escapes its base directory with "..".`);
    }
    segments.push(segment);
  }
  if (segments.length === 0) return '.';
  return segments.join('/');
}

/** Joins normalized relative paths ("." is the identity). */
export function joinRelative(...parts: string[]): string {
  const segments = parts.filter((part) => part && part !== '.').join('/');
  return segments === '' ? '.' : normalizeRelativePath(segments);
}

/**
 * Ensures an absolute filesystem path stays inside `root`.
 * Works with both Windows and POSIX separators and is case-insensitive on
 * Windows-style paths.
 */
export function isInside(root: string, candidate: string): boolean {
  const normalize = (value: string) => {
    let result = value.replace(/\\/g, '/').replace(/\/+$/, '');
    if (/^[a-zA-Z]:/.test(result)) result = result.toLowerCase();
    return result;
  };
  const base = normalize(root);
  const target = normalize(candidate);
  return target === base || target.startsWith(`${base}/`);
}
