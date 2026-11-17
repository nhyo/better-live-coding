/**
 * Distinguishes the presentation's own document edits from external edits.
 *
 * VS Code reports document changes asynchronously. An edit is treated as our
 * own while an edit to that file is in flight, or when the change event's
 * document version is not newer than the version our last edit produced.
 */

export class EditSuppressor {
  private readonly pending = new Map<string, number>();
  private readonly lastOwnVersion = new Map<string, number>();

  /** Runs an edit while marking the file as being edited by the presentation. */
  async run<T>(file: string, edit: () => Promise<T>, versionAfter?: () => number | undefined): Promise<T> {
    const key = normalizeKey(file);
    this.pending.set(key, (this.pending.get(key) ?? 0) + 1);
    try {
      return await edit();
    } finally {
      const version = versionAfter?.();
      if (version !== undefined) this.lastOwnVersion.set(key, Math.max(version, this.lastOwnVersion.get(key) ?? 0));
      const left = (this.pending.get(key) ?? 1) - 1;
      if (left <= 0) this.pending.delete(key);
      else this.pending.set(key, left);
    }
  }

  /** True when a change event belongs to an edit made by the presentation. */
  isOwnChange(file: string, version?: number): boolean {
    const key = normalizeKey(file);
    if ((this.pending.get(key) ?? 0) > 0) return true;
    const own = this.lastOwnVersion.get(key);
    return own !== undefined && version !== undefined && version <= own;
  }

  forget(file: string): void {
    const key = normalizeKey(file);
    this.pending.delete(key);
    this.lastOwnVersion.delete(key);
  }
}

function normalizeKey(file: string): string {
  const value = file.replace(/\\/g, '/');
  return /^[a-zA-Z]:/.test(value) ? value.toLowerCase() : value;
}
