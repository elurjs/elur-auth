type UserLike = Record<string, unknown> | null;
type ContextLike = Record<string, unknown> | undefined;
export type PolicyCheck = (user: UserLike, context: ContextLike, session: unknown) => boolean;

function resolveArray(user: UserLike, key: string): string[] {
  if (!user) return [];
  const value = user[key];
  return Array.isArray(value) ? (value as string[]) : [];
}

export function hasRole(role: string, resolver?: (user: UserLike) => string[]): PolicyCheck {
  return (user) => {
    const roles = resolver ? resolver(user) : resolveArray(user, "roles");
    return roles.includes(role);
  };
}

export function hasPermission(permission: string, resolver?: (user: UserLike) => string[]): PolicyCheck {
  return (user) => {
    const permissions = resolver ? resolver(user) : resolveArray(user, "permissions");
    return permissions.includes(permission);
  };
}

export function hasScope(scope: string, resolver?: (user: UserLike) => string[]): PolicyCheck {
  return (user) => {
    const scopes = resolver ? resolver(user) : resolveArray(user, "scopes");
    return scopes.includes(scope);
  };
}

export function isOwner(
  _resource: string,
  id?: string | ((context: ContextLike) => string | undefined),
): PolicyCheck {
  return (user, context) => {
    const userId = user?.id ?? user?.sub;
    if (!userId) return false;
    const targetId = typeof id === "function" ? id(context) : id ?? context?.id;
    return String(userId) === String(targetId);
  };
}

export function all(...checks: PolicyCheck[]): PolicyCheck {
  return (user, context, session) =>
    checks.every((check) => check(user, context, session));
}

export function any(...checks: PolicyCheck[]): PolicyCheck {
  return (user, context, session) =>
    checks.some((check) => check(user, context, session));
}

export function not(check: PolicyCheck): PolicyCheck {
  return (user, context, session) => !check(user, context, session);
}
