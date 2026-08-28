import { createAuth } from "./createAuth";
import type { AuthInstance, CreateAuthOptions } from "./types";

export interface AuthManager {
  create<Session = unknown, User = unknown, Credentials = unknown>(
    name: string,
    options: CreateAuthOptions<Session, User, Credentials>,
  ): AuthInstance<Session, User, Credentials>;
  get(name: string): AuthInstance<unknown, unknown, unknown> | undefined;
  has(name: string): boolean;
  remove(name: string): void;
  list(): string[];
  clear(): void;
}

export function createAuthManager(): AuthManager {
  const instances = new Map<string, AuthInstance>();

  return {
    create(name, options) {
      if (instances.has(name)) {
        throw new Error(`[elur-auth] Auth instance '${name}' already exists.`);
      }
      const auth = createAuth({ ...options, name });
      instances.set(name, auth);
      return auth;
    },
    get(name) {
      return instances.get(name);
    },
    has(name) {
      return instances.has(name);
    },
    remove(name) {
      const instance = instances.get(name);
      if (instance) {
        instance.dispose();
        instances.delete(name);
      }
    },
    list() {
      return [...instances.keys()];
    },
    clear() {
      for (const instance of instances.values()) {
        instance.dispose();
      }
      instances.clear();
    },
  };
}
