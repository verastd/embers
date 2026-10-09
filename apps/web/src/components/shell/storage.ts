/**
 * Per-browser preferences (sidebar groups, favorites, search history).
 * Every read and write tolerates blocked or corrupt storage: the preference
 * then lasts for this visit only.
 */
export function readStored<T>(key: string, fallback: T, valid: (v: unknown) => v is T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    const parsed: unknown = JSON.parse(raw);
    return valid(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function writeStored(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Blocked storage: kept in memory for this visit.
  }
}

export const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string');
