import type { AuthStorage } from "../core/types";

export interface SessionStorageAdapterOptions {
  key: string;
}

export function sessionStorageAdapter<Session>(
  options: SessionStorageAdapterOptions,
): AuthStorage<Session> {
  const { key } = options;
  const hasStorage = typeof globalThis !== "undefined" && "sessionStorage" in globalThis;

  return {
    get() {
      if (!hasStorage) return null;
      try {
        const raw = globalThis.sessionStorage.getItem(key);
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
          globalThis.sessionStorage.removeItem(key);
        } else {
          globalThis.sessionStorage.setItem(key, JSON.stringify(session));
        }
      } catch {
        // Ignore storage errors
      }
    },
    remove() {
      if (!hasStorage) return;
      try {
        globalThis.sessionStorage.removeItem(key);
      } catch {
      }
    },
  };
}
