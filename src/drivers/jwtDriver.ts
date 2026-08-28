import type { AuthDriver } from "../core/types";

export interface JwtSession<User = unknown> {
  user: User;
  token: string;
  refreshToken?: string;
  expiresAt?: number;
}

export interface JwtCredentials {
  email: string;
  password: string;
}

export interface JwtDriverOptions {
  loginUrl: string;
  logoutUrl?: string;
  refreshUrl?: string;
  headers?: Record<string, string>;
  fetcher?: (input: RequestInfo, init?: RequestInit) => Promise<Response>;
}

export function jwtDriver<User = unknown>(
  options: JwtDriverOptions,
): AuthDriver<JwtSession<User>, User, JwtCredentials> {
  const {
    loginUrl,
    logoutUrl,
    refreshUrl,
    headers = {},
    fetcher = globalThis.fetch.bind(globalThis),
  } = options;

  return {
    name: "jwt",

    async login(credentials) {
      const res = await fetcher(loginUrl, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(credentials),
      });
      if (!res.ok) {
        throw new Error(`[elur-auth] JWT login failed: ${res.status}`);
      }
      return (await res.json()) as JwtSession<User>;
    },

    async logout(session) {
      if (!logoutUrl) return;
      await fetcher(logoutUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${session.token}`,
          ...headers,
        },
      });
    },

    async refresh(session) {
      if (!refreshUrl) {
        throw new Error("[elur-auth] JWT refreshUrl not configured.");
      }
      const res = await fetcher(refreshUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${session.token}`,
          ...headers,
        },
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      });
      if (!res.ok) {
        throw new Error(`[elur-auth] JWT refresh failed: ${res.status}`);
      }
      return (await res.json()) as JwtSession<User>;
    },

    toUser(session) {
      return session.user;
    },

    getToken(session) {
      return session.token;
    },

    getExpiry(session) {
      return session.expiresAt;
    },
  };
}
