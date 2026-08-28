import type { AuthStorage } from "../core/types";

export interface CookieAdapterOptions {
  key: string;
  days?: number;
  path?: string;
  secure?: boolean;
  sameSite?: "strict" | "lax" | "none";
  /**
   * Suppress the security warning about storing tokens in JS-accessible cookies.
   * Only set this to true if you are storing non-sensitive data (e.g. a
   * session ID reference, UI preferences) — NOT JWTs or access tokens.
   * @default false
   */
  suppressSecurityWarning?: boolean;
}

function parseCookies(): Record<string, string> {
  const hasDocument = typeof globalThis !== "undefined" && "document" in globalThis;
  if (!hasDocument) return {};
  return Object.fromEntries(
    globalThis.document.cookie
      .split(";")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const index = entry.indexOf("=");
        return [entry.slice(0, index), entry.slice(index + 1)];
      }),
  );
}

/**
 * Persists session data to `document.cookie`.
 *
 * ⚠️ SECURITY WARNING: Cookies set via `document.cookie` are accessible from
 * JavaScript, making them vulnerable to XSS attacks. Do NOT store JWTs,
 * access tokens, or refresh tokens in this adapter.
 *
 * For sensitive tokens, use:
 * - `sessionCookieDriver` (relies on httpOnly cookies managed by the server)
 * - `localStorageAdapter` (still XSS-vulnerable, but less commonly targeted)
 * - A custom adapter backed by a secure httpOnly cookie set by the server
 *
 * Only use `cookieAdapter` for non-sensitive session references or low-security
 * state that needs to be shared with the server.
 */
export function cookieAdapter<Session>(options: CookieAdapterOptions): AuthStorage<Session> {
  const { key, days = 7, path = "/", secure, sameSite = "lax", suppressSecurityWarning = false } = options;
  const hasDocument = typeof globalThis !== "undefined" && "document" in globalThis;

  if (!suppressSecurityWarning && hasDocument && typeof console !== "undefined" && console.warn) {
    console.warn(
      "[elur-auth] cookieAdapter stores data in document.cookie (JS-accessible)." +
      " Do NOT store JWTs or tokens here — use sessionCookieDriver (httpOnly)" +
      " or localStorageAdapter instead. Set suppressSecurityWarning: true to silence this.",
    );
  }

  return {
    get() {
      if (!hasDocument) return null;
      try {
        const raw = parseCookies()[key];
        if (!raw) return null;
        return JSON.parse(decodeURIComponent(raw)) as Session;
      } catch {
        return null;
      }
    },
    set(session) {
      if (!hasDocument) return;
      const flags = [
        `path=${path}`,
        `max-age=${session === null ? 0 : days * 24 * 60 * 60}`,
        `samesite=${sameSite}`,
        secure ? "secure" : "",
      ]
        .filter(Boolean)
        .join("; ");
      if (session === null) {
        globalThis.document.cookie = `${key}=; ${flags}`;
      } else {
        const value = encodeURIComponent(JSON.stringify(session));
        globalThis.document.cookie = `${key}=${value}; ${flags}`;
      }
    },
    remove() {
      if (!hasDocument) return;
      const flags = [`path=${path}`, "max-age=0", `samesite=${sameSite}`, secure ? "secure" : ""]
        .filter(Boolean)
        .join("; ");
      globalThis.document.cookie = `${key}=; ${flags}`;
    },
  };
}
