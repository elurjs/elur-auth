import type { AuthDriver } from "../core/types";

export interface SessionCookieSession<User = unknown> {
  user: User;
  expiresAt?: number;
}

export interface SessionCookieCredentials {
  email: string;
  password: string;
  [key: string]: unknown;
}

export interface SessionCookieDriverOptions {
  loginUrl: string;
  logoutUrl?: string;
  sessionUrl?: string;
  fetcher?: (input: RequestInfo, init?: RequestInit) => Promise<Response>;
}

export function sessionCookieDriver<User = unknown>(
  options: SessionCookieDriverOptions,
): AuthDriver<SessionCookieSession<User>, User, SessionCookieCredentials> {
  const {
    loginUrl,
    logoutUrl,
    sessionUrl,
    fetcher = globalThis.fetch.bind(globalThis),
  } = options;

  return {
    name: "sessionCookie",

    async login(credentials) {
      const res = await fetcher(loginUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(credentials),
        credentials: "include",
      });
      if (!res.ok) {
        throw new Error(`[elur-auth] Session cookie login failed: ${res.status}`);
      }
      return (await res.json()) as SessionCookieSession<User>;
    },

    async logout() {
      if (!logoutUrl) return;
      await fetcher(logoutUrl, {
        method: "POST",
        credentials: "include",
      });
    },

    async hydrate(_raw) {
      if (!sessionUrl) return null;
      try {
        const res = await fetcher(sessionUrl, {
          credentials: "include",
        });
        if (!res.ok) return null;
        return (await res.json()) as SessionCookieSession<User>;
      } catch {
        return null;
      }
    },

    toUser(session) {
      return session.user;
    },

    getExpiry(session) {
      return session.expiresAt;
    },
  };
}
