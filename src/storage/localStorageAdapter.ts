import type { AuthStorage } from "../core/types";

export interface LocalStorageAdapterOptions {
  key: string;
}

export function localStorageAdapter<Session>(
  options: LocalStorageAdapterOptions,
): AuthStorage<Session> {
  const { key } = options;
  const hasStorage = typeof globalThis !== "undefined" && "localStorage" in globalThis;

  return {
    get() {
      if (!hasStorage) return null;
      try {
        const raw = globalThis.localStorage.getItem(key);
        if (raw === null) return null;
        return JSON.parse(raw) as Session;
      } catch {
        return null;
      }
    },
    set(session) {
      if (!hasStorage) return;
      try {
        if (session === null) {
          globalThis.localStorage.removeItem(key);
        } else {
          globalThis.localStorage.setItem(key, JSON.stringify(session));
        }
      } catch {
        // Ignore storage errors (e.g. private mode)
      }
    },
    remove() {
      if (!hasStorage) return;
      try {
        globalThis.localStorage.removeItem(key);
      } catch {
      }
    },
  };
}
