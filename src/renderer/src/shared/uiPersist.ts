function getStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch {
    return null;
  }

  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    return null;
  }

  return null;
}

function normalizeScopePart(value: string): string {
  return encodeURIComponent(value.replace(/\\/g, '/').toLowerCase());
}

export function buildStorageKey(baseKey: string, scope?: string): string {
  if (!scope) return baseKey;
  return `${baseKey}:${normalizeScopePart(scope)}`;
}

export function loadStoredString(key: string): string | null {
  try {
    return getStorage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function saveStoredString(key: string, value: string): void {
  try {
    getStorage()?.setItem(key, value);
  } catch {
    // ignore quota / privacy mode
  }
}

export function removeStoredValue(key: string): void {
  try {
    getStorage()?.removeItem(key);
  } catch {
    // ignore
  }
}

export function loadStoredJson<T>(key: string): T | null {
  const raw = loadStoredString(key);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function saveStoredJson(key: string, value: unknown): void {
  try {
    saveStoredString(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

export function loadStoredNumber(key: string): number | null {
  const raw = loadStoredString(key);
  if (!raw) return null;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function saveStoredNumber(key: string, value: number): void {
  saveStoredString(key, String(value));
}
