import type { AuthDriver } from "../core/types";

export interface MockDriverOptions<Session, User, Credentials> {
  name?: string;
  login?: (credentials: Credentials) => Promise<Session>;
  logout?: (session: Session) => Promise<void>;
  refresh?: (session: Session) => Promise<Session>;
  toUser?: (session: Session) => User;
  getToken?: (session: Session) => string | null;
  getExpiry?: (session: Session) => number | undefined;
  isValid?: (session: Session) => boolean;
  hydrate?: (raw: unknown) => Promise<Session | null>;
}

export function mockDriver<Session = unknown, User = unknown, Credentials = unknown>(
  options: MockDriverOptions<Session, User, Credentials> = {},
): AuthDriver<Session, User, Credentials> {
  return {
    name: options.name ?? "mock",
    login: options.login ?? (() => Promise.reject(new Error("[elur-auth] mock login not implemented"))),
    logout: options.logout ?? (() => Promise.resolve()),
    refresh: options.refresh,
    toUser: options.toUser,
    getToken: options.getToken,
    getExpiry: options.getExpiry,
    isValid: options.isValid,
    hydrate: options.hydrate,
  };
}
