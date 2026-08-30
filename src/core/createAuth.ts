import { signal, computed, batch } from "@elurjs/core";
import type { Signal } from "@elurjs/core";
import type {
  AuthDriver,
  AuthPolicy,
  AuthIdentity,
  CreateAuthOptions,
  AuthInstance,
  PolicyDecision,
  RefreshOptions,
} from "./types";

function makeResolver<User>(
  identity: AuthIdentity<User> | undefined,
  key: keyof AuthIdentity<User>,
  defaultKey: string,
): (user: User | null) => string[] {
  return (user: User | null) => {
    if (!user) return [];
    const resolver = identity?.[key];
    if (typeof resolver === "function") {
      return resolver(user) ?? [];
    }
    const field = typeof resolver === "string" ? resolver : defaultKey;
    return ((user as Record<string, unknown>)[field] as string[]) ?? [];
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getErrorStatus(error: unknown): number | undefined {
  if (!isObject(error)) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

function defaultIsTransientError(error: unknown): boolean {
  // TypeError = network failure (fetch throws TypeError on network errors)
  if (error instanceof TypeError) return true;
  const status = getErrorStatus(error);
  if (status === undefined) return true; // unknown error, assume transient
  return status >= 500 || status === 429;
}

function defaultRetryDelay(failureCount: number): number {
  return Math.min(1000 * 2 ** failureCount, 5000);
}

function isAuthError(error: unknown): boolean {
  const status = getErrorStatus(error);
  return status === 401 || status === 403;
}

/**
 * @internal — Global registry of live auth instances for devtools.
 * Shared via `Symbol.for` so it survives module duplication in bundles.
 */
const _instancesKey = Symbol.for("@elurjs/auth/instances");

function _getInstanceRegistry(): Set<AuthInstance<unknown, unknown, unknown>> {
  const g = globalThis as Record<PropertyKey, unknown>;
  let set = g[_instancesKey] as Set<AuthInstance<unknown, unknown, unknown>> | undefined;
  if (!set) {
    set = new Set();
    g[_instancesKey] = set;
  }
  return set;
}

function _registerAuthInstance(instance: AuthInstance<unknown, unknown, unknown>): void {
  _getInstanceRegistry().add(instance);
}

function _unregisterAuthInstance(instance: AuthInstance<unknown, unknown, unknown>): void {
  _getInstanceRegistry().delete(instance);
}

type AnyAuthInstance = AuthInstance<unknown, unknown, unknown>;

export function createAuth<
  Session = unknown,
  User = unknown,
  Credentials = unknown,
>(
  options: CreateAuthOptions<Session, User, Credentials>,
): AuthInstance<Session, User, Credentials> {
  const {
    driver,
    providers,
    defaultProvider,
    storage,
    autoRefresh,
    seed,
    identity,
    onChange,
    onError,
    name = "default",
    refreshOptions = {},
    multiTabSync = {},
  } = options;

  if (!driver && !providers) {
    throw new Error("[elur-auth] createAuth requires either a 'driver' or 'providers' option.");
  }

  const providerMap = providers ?? {};
  const hasProviders = Object.keys(providerMap).length > 0;
  const activeDriver = signal<AuthDriver<Session, User, Credentials> | null>(
    driver ?? (defaultProvider ? providerMap[defaultProvider] : null) ?? null,
  );
  const activeProvider = signal<string | null>(
    driver ? driver.name : defaultProvider ?? null,
  );

  const session = signal<Session | null>(null);
  const isReady = signal(false);
  const isLoading = signal(false);
  const error = signal<unknown>(null);
  const policiesVersion = signal(0);

  const policies: AuthPolicy<User, Session>[] = [];

  const resolveRoles = makeResolver<User>(identity, "roles", "roles");
  const resolvePermissions = makeResolver<User>(identity, "permissions", "permissions");
  const resolveScopes = makeResolver<User>(identity, "scopes", "scopes");

  const user = computed<User | null>(() => {
    const s = session.value;
    if (s === null) return null;
    const d = activeDriver.value;
    if (d?.toUser) return d.toUser(s);
    return s as unknown as User;
  });

  const token = computed<string | null>(() => {
    const s = session.value;
    if (s === null) return null;
    const d = activeDriver.value;
    if (d?.getToken) return d.getToken(s);
    const raw = s as unknown as Record<string, unknown>;
    return (raw.token as string | undefined) ?? (raw.accessToken as string | undefined) ?? null;
  });

  const isAuthenticated = computed(() => user.value !== null);
  const isAnonymous = computed(() => user.value === null);

  const userRoles = computed(() => resolveRoles(user.value));
  const userPermissions = computed(() => resolvePermissions(user.value));
  const userScopes = computed(() => resolveScopes(user.value));

  const autoRefreshEnabled = Boolean(autoRefresh);
  const autoRefreshConfig = typeof autoRefresh === "object" ? autoRefresh : {};

  let refreshDispose: (() => void) | null = null;

  function clearAutoRefresh() {
    if (refreshDispose) {
      refreshDispose();
      refreshDispose = null;
    }
  }

  function defaultSchedule(session: Session, refresh: () => Promise<void>): () => void {
    const d = activeDriver.value;
    const expiresAt = d?.getExpiry?.(session);
    if (!expiresAt) return () => { };
    const beforeMs = (autoRefreshConfig.beforeExpirySeconds ?? 60) * 1000;
    const delay = Math.max(0, expiresAt - Date.now() - beforeMs);
    const timer = setTimeout(() => {
      void refresh();
    }, delay);
    return () => clearTimeout(timer);
  }

  function scheduleAutoRefresh(s: Session) {
    clearAutoRefresh();
    if (!autoRefreshEnabled) return;
    const scheduler = autoRefreshConfig.schedule ?? defaultSchedule;
    refreshDispose = scheduler(s, refresh);
  }

  function setSession(next: Session | null) {
    batch(() => {
      session.value = next;
      error.value = null;
    });
    if (storage) {
      try {
        void storage.set(next);
      } catch (err) {
        onError?.(err, "setSession");
      }
    }
    onChange?.(next);
    if (next) {
      scheduleAutoRefresh(next);
      _broadcast("auth:login", next);
    } else {
      clearAutoRefresh();
    }
  }

  function clearSession() {
    clearAutoRefresh();
    setSession(null);
    _broadcast("auth:logout", null);
    if (hasProviders) {
      activeDriver.value = defaultProvider ? providerMap[defaultProvider] : null;
      activeProvider.value = defaultProvider ?? null;
    }
  }

  // ─── Multi-tab sync via BroadcastChannel (Fix #7) ──────────────────────
  let _broadcastChannel: BroadcastChannel | null = null;
  let _isSyncingFromBroadcast = false;

  function _initMultiTabSync(): void {
    if (!multiTabSync.enabled) return;
    if (typeof globalThis === "undefined" || typeof BroadcastChannel === "undefined") return;

    const channelName = multiTabSync.channelName ?? `elur-auth:${name}`;
    _broadcastChannel = new BroadcastChannel(channelName);

    _broadcastChannel.addEventListener("message", (event) => {
      const data = event.data as { type: string; session: Session | null };
      if (!data || typeof data.type !== "string") return;

      _isSyncingFromBroadcast = true;
      try {
        if (data.type === "auth:login" || data.type === "auth:refresh") {
          if (data.session !== null) {
            setSession(data.session);
          }
        } else if (data.type === "auth:logout") {
          clearAutoRefresh();
          session.value = null;
          error.value = null;
          if (storage) {
            try { void storage.set(null); } catch { /* ignore */ }
          }
          if (hasProviders) {
            activeDriver.value = defaultProvider ? providerMap[defaultProvider] : null;
            activeProvider.value = defaultProvider ?? null;
          }
        }
        onError?.(null, "sync");
      } finally {
        _isSyncingFromBroadcast = false;
      }
    });
  }

  function _broadcast(type: string, nextSession: Session | null): void {
    if (!_broadcastChannel || _isSyncingFromBroadcast) return;
    try {
      _broadcastChannel.postMessage({ type, session: nextSession });
    } catch {
      // Ignore broadcast errors
    }
  }

  async function resolveDriver(
    provider?: string,
  ): Promise<AuthDriver<Session, User, Credentials>> {
    const d = provider ? providerMap[provider] : activeDriver.value;
    if (!d) {
      throw new Error(
        `[elur-auth] No driver available${provider ? ` for provider '${provider}'` : ""}.`,
      );
    }
    if (provider) {
      batch(() => {
        activeDriver.value = d;
        activeProvider.value = provider;
      });
    }
    return d;
  }

  async function login(...args: [Credentials] | [string, Credentials]): Promise<void> {
    const [first, second] = args;
    const providerName = typeof first === "string" ? first : undefined;
    const credentials = (providerName ? second : first) as Credentials;

    const d = await resolveDriver(providerName);
    isLoading.value = true;
    error.value = null;
    try {
      const next = await d.login(credentials);
      setSession(next);
    } catch (err) {
      error.value = err;
      onError?.(err, "login");
      throw err;
    } finally {
      isLoading.value = false;
    }
  }

  async function logout(): Promise<void> {
    const current = session.value;
    const d = activeDriver.value;
    if (current && d) {
      try {
        await d.logout(current);
      } catch (err) {
        onError?.(err, "logout");
      }
    }
    clearSession();
  }

  const _refreshCfg: Required<RefreshOptions> = {
    maxRetries: refreshOptions.maxRetries ?? 3,
    retryDelay: refreshOptions.retryDelay ?? defaultRetryDelay,
    isTransientError: refreshOptions.isTransientError ?? defaultIsTransientError,
  };

  function _computeRetryDelay(failureCount: number): number {
    const policy = _refreshCfg.retryDelay;
    if (typeof policy === "function") return Math.max(0, policy(failureCount));
    return Math.max(0, policy);
  }

  async function refresh(): Promise<void> {
    const current = session.value;
    const d = activeDriver.value;
    if (!current || !d?.refresh) return;
    isLoading.value = true;

    let failures = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        const next = await d.refresh(current);
        setSession(next);
        return;
      } catch (err) {
        failures++;

        // Auth errors (401/403) → session is truly invalid, logout.
        if (isAuthError(err)) {
          error.value = err;
          onError?.(err, "refresh");
          isLoading.value = false;
          await logout();
          throw err;
        }

        // Transient error → retry with backoff, keep session alive.
        if (_refreshCfg.isTransientError(err) && failures <= _refreshCfg.maxRetries) {
          onError?.(err, "refresh");
          const delay = _computeRetryDelay(failures);
          if (delay > 0) {
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
          continue;
        }

        // Non-transient or max retries exhausted → keep session as stale but
        // don't logout. The user keeps access until the token truly expires.
        error.value = err;
        onError?.(err, "refresh");
        isLoading.value = false;
        throw err;
      }
    }
  }

  let readyPromise: Promise<void> | null = null;
  let readyRejected = false;

  function ready(options?: { force?: boolean }): Promise<void> {
    const force = options?.force ?? false;
    if (isReady.value && !force) return Promise.resolve();
    // Don't return a cached rejected promise — allow retry.
    if (readyPromise && !readyRejected && !force) return readyPromise;
    readyRejected = false;
    readyPromise = hydrate().catch((err) => {
      readyRejected = true;
      throw err;
    });
    return readyPromise;
  }

  async function hydrate(): Promise<void> {
    const d = activeDriver.value;
    if (!storage) {
      isReady.value = true;
      return;
    }
    try {
      const raw = await storage.get();
      let hydrated: Session | null = null;
      if (d?.hydrate) {
        hydrated = await d.hydrate(raw);
      } else if (raw !== null) {
        hydrated = raw;
        if (d?.isValid && !d.isValid(raw)) {
          hydrated = null;
        }
      }
      if (hydrated !== null) {
        setSession(hydrated);
      }
      isReady.value = true;
    } catch (err) {
      error.value = err;
      onError?.(err, "hydrate");
      // Don't set isReady on failure — allows ready() to retry.
      throw err;
    }
  }

  function isSeedFunction(
    value: Session | (() => Session | null) | undefined,
  ): value is () => Session | null {
    return typeof value === "function";
  }

  // Seed initial session for SSR / server render
  const initialSeed = isSeedFunction(seed) ? seed() : seed;
  if (initialSeed) {
    setSession(initialSeed);
  }

  // Initialize multi-tab sync (Fix #7)
  _initMultiTabSync();

  // Initialize hydration asynchronously
  void ready();

  function attachPolicy(policy: AuthPolicy<User, Session>): () => void {
    policies.push(policy);
    policiesVersion.value++;
    return () => detachPolicy(policy);
  }

  function detachPolicy(policy: AuthPolicy<User, Session>) {
    const index = policies.indexOf(policy);
    if (index >= 0) {
      policies.splice(index, 1);
      policiesVersion.value++;
    }
  }

  function resolveContext(context?: unknown): unknown {
    return typeof context === "function" ? context() : context;
  }

  function evaluatePolicies(action: string, context: unknown): PolicyDecision {
    const u = user.value;
    const s = session.value;
    const ctx = resolveContext(context);
    for (const policy of policies) {
      const result = policy.evaluate(u, action, ctx, s);
      if (typeof result === "object" && result !== null) {
        return result;
      }
      if (result === true) return true;
      if (result === false) return false;
    }
    return false;
  }

  function checkCan(action: string, context?: unknown): boolean {
    const result = evaluatePolicies(action, context);
    return isObject(result) ? result.allow : result;
  }

  function checkAuthorize(
    action: string,
    context?: unknown,
  ): { allow: boolean; redirect?: string } {
    const result = evaluatePolicies(action, context);
    if (isObject(result)) {
      return { allow: result.allow, redirect: result.redirect };
    }
    return { allow: result };
  }

  function checkRole(role: string): boolean {
    return userRoles.value.includes(role);
  }

  function checkPermission(permission: string): boolean {
    return userPermissions.value.includes(permission);
  }

  function checkScope(scope: string): boolean {
    return userScopes.value.includes(scope);
  }

  function checkAnyRole(roles: string[]): boolean {
    const current = userRoles.value;
    return roles.some((role) => current.includes(role));
  }

  function checkAllPermissions(permissions: string[]): boolean {
    const current = userPermissions.value;
    return permissions.every((permission) => current.includes(permission));
  }

  function can(action: string, context?: unknown): Signal<boolean> {
    return computed(() => {
      policiesVersion.value; // subscribe to policy changes
      return checkCan(action, context);
    });
  }

  function authorize(
    action: string,
    context?: unknown,
  ): Signal<{ allow: boolean; redirect?: string }> {
    return computed(() => {
      policiesVersion.value; // subscribe to policy changes
      return checkAuthorize(action, context);
    });
  }

  function hasRole(role: string): Signal<boolean> {
    return computed(() => checkRole(role));
  }

  function hasPermission(permission: string): Signal<boolean> {
    return computed(() => checkPermission(permission));
  }

  function hasScope(scope: string): Signal<boolean> {
    return computed(() => checkScope(scope));
  }

  function hasAnyRole(roles: string[]): Signal<boolean> {
    return computed(() => checkAnyRole(roles));
  }

  function hasAllPermissions(permissions: string[]): Signal<boolean> {
    return computed(() => checkAllPermissions(permissions));
  }

  function dispose(): void {
    clearAutoRefresh();
    if (_broadcastChannel) {
      _broadcastChannel.close();
      _broadcastChannel = null;
    }
    _unregisterAuthInstance(instance as unknown as AnyAuthInstance);
  }

  const instance: AuthInstance<Session, User, Credentials> = {
    name,
    session,
    user,
    token,
    isAuthenticated,
    isAnonymous,
    isReady,
    isLoading,
    error,
    activeProvider,
    login,
    logout,
    refresh,
    ready,
    setSession,
    clearSession,
    attachPolicy,
    detachPolicy,
    can,
    authorize,
    hasRole,
    hasPermission,
    hasScope,
    hasAnyRole,
    hasAllPermissions,
    checkCan,
    checkAuthorize,
    checkRole,
    checkPermission,
    checkScope,
    checkAnyRole,
    checkAllPermissions,
    dispose,
  };

  _registerAuthInstance(instance as unknown as AnyAuthInstance);
  return instance;
}
