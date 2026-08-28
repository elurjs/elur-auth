import { createInjectionKey, inject, signal, computed } from "@elurjs/core";
import type { Signal } from "@elurjs/core";
import type { AuthInstance } from "./core/types";

export const AuthKey = createInjectionKey<AuthInstance<unknown, unknown>>("elur:auth");

// Global reactive holder for the active auth instance (Fix #6).
// Allows useAuth() to be reactive when the auth instance changes at runtime
// (e.g. multi-tenant dynamic switching).
const _activeAuth = signal<AuthInstance<unknown, unknown> | undefined>(undefined);

/**
 * Sets the active auth instance globally. Call this when providing auth to
 * the component tree, or when switching tenants dynamically.
 */
export function setActiveAuth<Session, User>(
  auth: AuthInstance<Session, User> | undefined,
): void {
  _activeAuth.value = auth as AuthInstance<unknown, unknown> | undefined;
}

/**
 * Returns the active AuthInstance reactively.
 *
 * The returned Signal tracks changes to the active auth instance, so
 * components re-render when the instance is swapped (e.g. multi-tenant).
 *
 * If an auth instance was provided via `provide(AuthKey, auth)` in the
 * component tree, that takes priority. Otherwise the globally active
 * instance (set via `setActiveAuth`) is used.
 */
export function useAuth<Session = unknown, User = unknown>(): Signal<AuthInstance<Session, User> | undefined> {
  // Try injected context first, fall back to global reactive signal.
  const injected = inject(AuthKey) as AuthInstance<Session, User> | undefined;
  if (injected) {
    return signal(injected);
  }
  return computed(
    () => _activeAuth.value as AuthInstance<Session, User> | undefined,
  );
}

/**
 * Non-reactive version of useAuth for one-off access (guards, plugins).
 */
export function getAuth<Session = unknown, User = unknown>(): AuthInstance<Session, User> | undefined {
  const injected = inject(AuthKey) as AuthInstance<Session, User> | undefined;
  if (injected) return injected;
  return _activeAuth.value as AuthInstance<Session, User> | undefined;
}
