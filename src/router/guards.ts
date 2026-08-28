import type { NavigationGuard } from "@elurjs/core/router";
import type { AuthInstance } from "../core/types";

export function requireAuth<Session, User>(
  auth: AuthInstance<Session, User>,
  redirect = "/login",
): NavigationGuard {
  return () => (auth.isAuthenticated.value ? undefined : redirect);
}

export function requireRole<Session, User>(
  auth: AuthInstance<Session, User>,
  role: string,
  redirect = "/unauthorized",
): NavigationGuard {
  return () => (auth.checkRole(role) ? undefined : redirect);
}

export function requirePermission<Session, User>(
  auth: AuthInstance<Session, User>,
  permission: string,
  redirect = "/unauthorized",
): NavigationGuard {
  return () => (auth.checkPermission(permission) ? undefined : redirect);
}

export function requireProvider<Session, User>(
  auth: AuthInstance<Session, User>,
  provider: string,
  redirect = "/login",
): NavigationGuard {
  return () => (auth.activeProvider.value === provider ? undefined : redirect);
}

export function requirePolicy<Session, User>(
  auth: AuthInstance<Session, User>,
  predicate: (to: string, from: string, auth: AuthInstance<Session, User>) => boolean,
  redirect = "/unauthorized",
): NavigationGuard {
  return (to, from) => (predicate(to, from, auth) ? undefined : redirect);
}
