import type { Router, NavigationGuard, NavigationGuardResult } from "@elurjs/core/router";
import type { AuthInstance } from "../core/types";
import type { RouteAuthMeta, RouteAuthMetaObject, MetaInterpreter } from "./meta";
import { isPublic } from "./meta";

export interface AuthRouterPluginOptions {
  public?: (string | RegExp)[];
  defaultRedirect?: string;
  fallbackRedirect?: string;
  interpretMeta?: MetaInterpreter;
  /**
   * Time-to-live in ms for cached meta resolution results per route path.
   * Set to 0 to disable caching. @default 0 (disabled by default for safety)
   */
  metaCacheTtl?: number;
}

function isPublicPath(path: string, patterns: (string | RegExp)[]): boolean {
  return patterns.some((pattern) =>
    typeof pattern === "string" ? path === pattern : pattern.test(path),
  );
}

function resolveContext(context?: unknown): unknown {
  return typeof context === "function" ? context() : context;
}

function defaultCanMeta(
  meta: string | string[],
  auth: AuthInstance,
  fallbackRedirect: string,
): NavigationGuardResult {
  const actions = Array.isArray(meta) ? meta : [meta];
  const allowed = actions.some((action) => auth.checkCan(action));
  return allowed ? undefined : fallbackRedirect;
}

async function defaultObjectMeta(
  meta: RouteAuthMetaObject,
  auth: AuthInstance,
  to: string,
  from: string,
  fallbackRedirect: string,
): Promise<NavigationGuardResult> {
  const redirect = meta.redirect ?? fallbackRedirect;

  if (meta.provider && auth.activeProvider.value !== meta.provider) {
    return redirect;
  }

  if (meta.can) {
    const context = resolveContext(meta.context);
    return auth.checkCan(meta.can, context) ? undefined : redirect;
  }

  if (meta.role && !auth.checkRole(meta.role)) {
    return redirect;
  }

  if (meta.roles && !auth.checkAnyRole(meta.roles)) {
    return redirect;
  }

  if (meta.permission && !auth.checkPermission(meta.permission)) {
    return redirect;
  }

  if (meta.permissions && !auth.checkAllPermissions(meta.permissions)) {
    return redirect;
  }

  if (meta.allow === false) {
    return redirect;
  }

  if (typeof meta.allow === "function") {
    const raw = await meta.allow(to, from, auth);
    return raw === true || raw === undefined || raw === null ? undefined : raw === false ? redirect : raw;
  }

  return undefined;
}

async function defaultMetaInterpreter(
  meta: RouteAuthMeta | undefined,
  auth: AuthInstance,
  to: string,
  from: string,
  fallbackRedirect: string,
): Promise<NavigationGuardResult> {
  if (isPublic(meta)) {
    return undefined;
  }

  if (meta === "optional") {
    return undefined;
  }

  if (typeof meta === "string") {
    return defaultCanMeta(meta, auth, fallbackRedirect);
  }

  if (Array.isArray(meta)) {
    return defaultCanMeta(meta, auth, fallbackRedirect);
  }

  if (typeof meta === "function") {
    return await meta(to, from, auth);
  }

  if (meta && typeof meta === "object") {
    return defaultObjectMeta(meta, auth, to, from, fallbackRedirect);
  }

  return undefined;
}

export function authRouterPlugin<Session, User>(
  auth: AuthInstance<Session, User>,
  router: Router,
  options: AuthRouterPluginOptions = {},
): NavigationGuard {
  const {
    public: publicPaths = [],
    defaultRedirect = "/login",
    fallbackRedirect = "/unauthorized",
    interpretMeta,
    metaCacheTtl = 0,
  } = options;

  // Meta resolution cache (Fix #5): caches the result of interpretMeta per
  // route path for a short TTL. Only enabled when metaCacheTtl > 0.
  const _CACHE_MISS = Symbol("cache-miss");
  const _metaCache = new Map<string, { result: NavigationGuardResult | typeof _CACHE_MISS; expiresAt: number }>();

  function getCachedMeta(path: string): NavigationGuardResult | typeof _CACHE_MISS {
    if (metaCacheTtl <= 0) return _CACHE_MISS;
    const entry = _metaCache.get(path);
    if (!entry) return _CACHE_MISS;
    if (Date.now() > entry.expiresAt) {
      _metaCache.delete(path);
      return _CACHE_MISS;
    }
    return entry.result;
  }

  function setCachedMeta(path: string, result: NavigationGuardResult): void {
    if (metaCacheTtl <= 0) return;
    _metaCache.set(path, { result, expiresAt: Date.now() + metaCacheTtl });
  }

  return async (to, from) => {
    await auth.ready();

    if (isPublicPath(to, publicPaths)) {
      return undefined;
    }

    if (!auth.isAuthenticated.value) {
      return defaultRedirect;
    }

    // Check meta cache first (Fix #5)
    const cached = getCachedMeta(to);
    if (cached !== _CACHE_MISS) {
      return cached;
    }

    const resolved = router.resolve(to);
    const meta = resolved.route?.meta?.auth as RouteAuthMeta | undefined;

    let result: NavigationGuardResult;
    if (interpretMeta) {
      result = await interpretMeta(meta, auth, to, from);
    } else {
      result = await defaultMetaInterpreter(meta, auth, to, from, fallbackRedirect);
    }

    setCachedMeta(to, result);
    return result;
  };
}
