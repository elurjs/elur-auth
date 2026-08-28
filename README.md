# @elurjs/auth

[![npm version](https://img.shields.io/npm/v/@elurjs/auth.svg)](https://www.npmjs.com/package/@elurjs/auth)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

Authentication and authorization library for [Elur](https://elur.dev) built entirely on reactive signals.

**Agnostic by design.** Bring your own driver, your own user model, and your own authorization rules. The library only orchestrates state and exposes it as signals that the router, templates, and components can read reactively.

## Table of contents

- [Features](#features)
- [Installation](#installation)
- [Core concepts](#core-concepts)
- [Quick start](#quick-start)
- [Core API](#core-api)
- [Drivers](#drivers)
- [Providers](#providers)
- [Storage adapters](#storage-adapters)
- [Auth manager](#auth-manager)
- [SSR seeds](#ssr-seeds)
- [Policy engine](#policy-engine)
- [Router integration](#router-integration)
- [Optional provide/inject](#optional-provideinject)
- [Multi-provider](#multi-provider)
- [Auto-refresh](#auto-refresh)
- [Optional `elur-query` integration](#optional-elur-query-integration)
- [Testing](#testing)
- [Best practices](#best-practices)
- [TypeScript](#typescript)
- [API overview](#api-overview)
- [FAQ](#faq)
- [License](#license)

## Features

- **Signal-based state**: `auth.user`, `auth.isAuthenticated`, `auth.can(...)` are reactive signals.
- **Driver-based core**: connect JWT, session cookies, API keys, OIDC, or any custom backend.
- **Custom user model**: no forced `roles` or `permissions` fields; use identity mapping or custom policies.
- **Policy engine**: compose authorization rules with `createPolicy`, `rbacPolicy` (with tenant support), and helpers.
- **Router integration**: declarative `meta.auth` DSL and standalone guards.
- **Optional `provide/inject`**: use `auth` directly or inject it via `useAuth()`.
- **Multiple providers**: support email/password, API keys, OIDC, and other strategies in the same app.
- **Auto-refresh**: automatically refresh tokens before expiry; custom schedules supported.
- **Storage adapters**: localStorage, sessionStorage, cookies, and memory.
- **Auth manager**: `createAuthManager` for multi-context or multi-tenant apps.
- **SSR seeds**: `seed` option for server-side rendering.
- **Optional `elur-query` integration**: auth-aware commands via `@elurjs/auth/command`.
- **TypeScript-first**: full generic support for `Session`, `User`, and `Credentials`.

## Installation

```bash
npm install @elurjs/core @elurjs/auth
```

`@elurjs/core` is a peer dependency.

## Core concepts

### Auth instance

An `AuthInstance` is the central object. It holds signals for the current session and user, and exposes methods to log in, log out, refresh, and evaluate policies.

```ts
const auth = createAuth({ driver, storage });
```

### Driver

A driver knows how to talk to your backend. It is the only place where HTTP calls, OAuth redirects, or biometric flows live. The core does not assume any transport.

### Policy

A policy is a pure function that decides whether a user can perform an action. Policies are attached to the auth instance and evaluated by `auth.can()`.

### Router guard

`authRouterPlugin` reads the `meta.auth` field of each route and decides whether to allow navigation, redirect to login, or redirect to an unauthorized page.

## Quick start

```ts
import { createAuth, jwtDriver, localStorageAdapter, createPolicy } from "@elurjs/auth";

const auth = createAuth({
  driver: jwtDriver({
    loginUrl: "/api/login",
    refreshUrl: "/api/refresh",
  }),
  storage: localStorageAdapter({ key: "app:session" }),
  identity: {
    roles: "roles",
    permissions: "permissions",
  },
});

auth.attachPolicy(
  createPolicy((user, action, context) => {
    if (!user) return false;
    if (action === "post:edit") {
      return user.permissions?.includes("post:edit") || user.id === context.authorId;
    }
    return false;
  }),
);

await auth.login({ email: "deiver@example.com", password: "secret" });

console.log(auth.isAuthenticated.value); // true
console.log(auth.can("post:edit", { authorId: "42" }).value); // true | false
```

## Core API

### `createAuth(options)`

Creates a reactive auth instance.

```ts
interface CreateAuthOptions<Session, User, Credentials> {
  driver?: AuthDriver<Session, User, Credentials>;
  providers?: Record<string, AuthDriver<Session, User, Credentials>>;
  defaultProvider?: string;
  storage?: AuthStorage<Session>;
  autoRefresh?: boolean | AutoRefreshOptions<Session>;
  seed?: Session | (() => Session | null);
  identity?: AuthIdentity<User>;
  onChange?: (session: Session | null) => void;
  onError?: (error: unknown, event: AuthEvent) => void;
  name?: string;
  refreshOptions?: RefreshOptions;
  multiTabSync?: MultiTabSyncOptions;
}

interface AutoRefreshOptions<Session> {
  beforeExpirySeconds?: number;
  schedule?: (session: Session, refresh: () => Promise<void>) => (() => void);
}

interface RefreshOptions {
  maxRetries?: number; // default: 3
  retryDelay?: number | ((failureCount: number) => number); // default: exponential
  isTransientError?: (error: unknown) => boolean; // default: 5xx, 429, TypeError
}

interface MultiTabSyncOptions {
  enabled?: boolean; // default: false
  channelName?: string; // default: "elur-auth:<name>"
}
```

### Signals

| Signal | Type | Description |
| --- | --- | --- |
| `auth.session` | `Signal<Session \| null>` | Raw session data returned by the driver. |
| `auth.user` | `Signal<User \| null>` | User object derived from the session via `driver.toUser`. |
| `auth.token` | `Signal<string \| null>` | Token extracted from the session. |
| `auth.isAuthenticated` | `Signal<boolean>` | `true` when `user` is not null. |
| `auth.isAnonymous` | `Signal<boolean>` | `true` when `user` is null. |
| `auth.isReady` | `Signal<boolean>` | `true` after the initial storage hydration completes. |
| `auth.isLoading` | `Signal<boolean>` | `true` during login, logout, or refresh. |
| `auth.error` | `Signal<unknown>` | Last error encountered. |
| `auth.activeProvider` | `Signal<string \| null>` | Current provider name when providers are used. |

### Methods

```ts
// Authentication
await auth.login(credentials);
await auth.logout();
await auth.refresh();
await auth.ready();

// Manual session control
auth.setSession(session);
auth.clearSession();

// Policies
auth.attachPolicy(policy);
auth.detachPolicy(policy);

// Authorization checks
const allowed = auth.can("post:edit", { id: "42" }).value;
const decision = auth.authorize("post:edit", { id: "42" }).value; // { allow, redirect? }

// Identity helpers
auth.hasRole("admin").value;
auth.hasPermission("post:edit").value;
auth.hasScope("read").value;
auth.hasAnyRole(["admin", "editor"]).value;
auth.hasAllPermissions(["post:edit", "post:publish"]).value;
```

### Identity mapping

The `identity` option maps the helpers to your user fields:

```ts
const auth = createAuth({
  driver,
  identity: {
    roles: "myRoles",
    permissions: (user) => user.claims,
    scopes: (user) => user.oauthScopes,
  },
});
```

If no mapping is provided, the helpers fall back to `user.roles`, `user.permissions`, and `user.scopes`.

## Drivers

A driver implements the `AuthDriver` interface:

```ts
interface AuthDriver<Session, User, Credentials> {
  name: string;
  login(credentials: Credentials): Promise<Session>;
  logout(session: Session): Promise<void>;
  hydrate?(raw: unknown): Promise<Session | null>;
  refresh?(session: Session): Promise<Session>;
  getExpiry?(session: Session): number | undefined;
  toUser?(session: Session): User;
  getToken?(session: Session): string | null;
  isValid?(session: Session): boolean;
}
```

### `jwtDriver(options)`

```ts
import { jwtDriver } from "@elurjs/auth";

const auth = createAuth({
  driver: jwtDriver({
    loginUrl: "/api/login",
    logoutUrl: "/api/logout",
    refreshUrl: "/api/refresh",
    headers: { "x-api-version": "v2" },
  }),
});
```

Expected session shape:

```ts
interface JwtSession<User> {
  user: User;
  token: string;
  refreshToken?: string;
  expiresAt?: number;
}
```

### `sessionCookieDriver(options)`

For backends that use `httpOnly` session cookies. The browser sends the cookie automatically with `credentials: "include"`.

```ts
import { sessionCookieDriver } from "@elurjs/auth";

const auth = createAuth({
  driver: sessionCookieDriver({
    loginUrl: "/api/login",
    logoutUrl: "/api/logout",
    sessionUrl: "/api/session",
  }),
  storage: cookieAdapter({ key: "app:session" }),
});
```

The driver will call `sessionUrl` during hydration to recover the current user from the server. If the session is expired, the server should return `401` and the driver will return `null`.

### `mockDriver(options)`

Useful for tests and prototypes.

```ts
import { mockDriver } from "@elurjs/auth";

const auth = createAuth({
  driver: mockDriver({
    name: "fake",
    login: async (creds) => ({ user: { id: "1", roles: ["admin"] }, token: "abc" }),
    toUser: (session) => session.user,
    getToken: (session) => session.token,
  }),
});
```

### Custom driver

```ts
const legacyDriver = {
  name: "legacy",
  async login(credentials) {
    const res = await fetch("/legacy/auth", {
      method: "POST",
      body: JSON.stringify(credentials),
    });
    return res.json();
  },
  async logout(session) {
    await fetch("/legacy/auth", {
      headers: { "X-Legacy-Token": session.token },
    });
  },
  toUser(session) {
    return session.employee;
  },
  getToken(session) {
    return session.token;
  },
  getExpiry(session) {
    return session.expiresAt;
  },
};

const auth = createAuth({ driver: legacyDriver });
```

### Hydration

If a driver implements `hydrate`, it can validate or re-fetch the session when loading from storage:

```ts
const driver = {
  // ...
  async hydrate(raw) {
    const res = await fetch("/api/session/validate", {
      headers: { Authorization: `Bearer ${(raw as any).token}` },
    });
    return res.ok ? (raw as Session) : null;
  },
};
```

### Refresh error handling (v1.2)

By default, `refresh()` retries transient errors (5xx, 429, network failures)
up to 3 times with exponential backoff, keeping the session alive. Only
401/403 errors trigger logout.

```ts
const auth = createAuth({
  driver,
  autoRefresh: true,
  refreshOptions: {
    maxRetries: 5,
    retryDelay: (failureCount) => Math.min(1000 * 2 ** failureCount, 10000),
    isTransientError: (err) => {
      // Custom predicate — return true to retry, false to logout
      const status = (err as { status?: number }).status;
      return status === undefined || status >= 500 || status === 429;
    },
  },
});
```

### Multi-tab synchronization (v1.2)

Enable `multiTabSync` to broadcast login/logout events across browser tabs
via `BroadcastChannel`:

```ts
const auth = createAuth({
  driver,
  storage: localStorageAdapter({ key: "app:session" }),
  multiTabSync: { enabled: true },
});
```

When the user logs in on Tab A, Tab B receives the session automatically.
When the user logs out on any tab, all tabs clear the session.

## Providers

A provider is a named driver. This is useful when an app supports multiple authentication mechanisms.

```ts
import { credentialsProvider, mockDriver } from "@elurjs/auth";

const auth = createAuth({
  providers: {
    credentials: credentialsProvider({
      login: async (creds) => {
        const res = await fetch("/api/login", {
          method: "POST",
          body: JSON.stringify(creds),
        });
        return res.json();
      },
    }),
    apiKey: mockDriver({
      name: "apiKey",
      login: async (creds) => ({ user: { id: "2" }, token: creds.key }),
    }),
  },
  defaultProvider: "credentials",
});

await auth.login("credentials", { email, password });
await auth.login("apiKey", { key: "secret" });

console.log(auth.activeProvider.value); // "apiKey"
```

### `apiKeyProvider(options)`

Provider for API-key authentication.

```ts
import { apiKeyProvider } from "@elurjs/auth";

const auth = createAuth({
  providers: {
    apiKey: apiKeyProvider({
      validate: async (key) => {
        const res = await fetch("/api/validate-key", {
          headers: { "x-api-key": key },
        });
        return res.json();
      },
    }),
  },
  defaultProvider: "apiKey",
});

await auth.login("apiKey", { key: "secret" });
```

### `oidcProvider(options)`

Basic OIDC provider with PKCE. The provider discovers endpoints from the issuer's `/.well-known/openid-configuration`.

```ts
import { oidcProvider } from "@elurjs/auth";

const provider = oidcProvider({
  authority: "https://idp.example.com",
  clientId: "client-id",
  redirectUri: "https://app.example.com/callback",
  postLogoutRedirectUri: "https://app.example.com",
  scope: "openid profile email",
});

const auth = createAuth({ driver: provider });

// 1. Start login
const loginUrl = await provider.buildLoginUrl();
window.location.href = loginUrl.url;
// Save loginUrl.state, loginUrl.codeVerifier and loginUrl.nonce

// 2. After callback, complete login
const params = new URLSearchParams(window.location.search);
const session = await auth.login({
  code: params.get("code")!,
  codeVerifier: savedCodeVerifier,
  state: params.get("state")!,
  nonce: savedNonce,
});

// 3. Logout — performLogout builds the URL and redirects automatically
await provider.performLogout(session, { mode: "redirect" });
// Or use a background fetch for back-channel logout:
// await provider.performLogout(session, { mode: "fetch" });
```

`performLogout(session, options)` (v1.2) builds the end_session URL and
executes the redirect (or background fetch) automatically. Supports a custom
`redirect` function for testing or non-browser environments.

## Storage adapters

Storage adapters are responsible for persisting the session between reloads.

```ts
import { localStorageAdapter, sessionStorageAdapter, cookieAdapter, memoryAdapter } from "@elurjs/auth";

const auth = createAuth({
  driver,
  storage: localStorageAdapter({ key: "app:session" }),
});
```

### `localStorageAdapter({ key })`

Persists to `localStorage`. Falls back to in-memory if storage is unavailable.

### `sessionStorageAdapter({ key })`

Persists to `sessionStorage`.

### `cookieAdapter({ key })`

Persists to `document.cookie`. Useful for non-`httpOnly` session data or for
sharing small state with the server.

> ⚠️ **Security warning**: Cookies set via `document.cookie` are accessible
> from JavaScript and vulnerable to XSS attacks. **Do NOT store JWTs or
> access tokens here.** Use `sessionCookieDriver` (httpOnly) or
> `localStorageAdapter` instead. The adapter emits a `console.warn` by
> default; set `suppressSecurityWarning: true` to silence it.

```ts
const auth = createAuth({
  driver,
  storage: cookieAdapter({
    key: "app:session",
    days: 7,
    sameSite: "lax",
    suppressSecurityWarning: true, // only if storing non-sensitive data
  }),
});
```

### `memoryAdapter()`

In-memory only. Useful for tests and server-side rendering seeds.

## Auth manager

For apps that need multiple auth instances (multi-context, multi-tenant, or admin + customer portals):

```ts
import { createAuthManager, jwtDriver, localStorageAdapter } from "@elurjs/auth";

const manager = createAuthManager();

const customer = manager.create("customer", {
  driver: jwtDriver({ loginUrl: "/api/customer/login" }),
  storage: localStorageAdapter({ key: "customer:session" }),
});

const admin = manager.create("admin", {
  driver: jwtDriver({ loginUrl: "/api/admin/login" }),
  storage: localStorageAdapter({ key: "admin:session" }),
});

console.log(manager.list()); // ["customer", "admin"]
console.log(manager.get("admin")); // AuthInstance

manager.remove("customer");
```

## SSR seeds

When rendering on the server, pass the initial session so the first client render is hydrated immediately:

```ts
const auth = createAuth({
  driver,
  seed: serverSession,
});
```

You can also pass a function that returns the seed:

```ts
const auth = createAuth({
  driver,
  seed: () => readSessionFromRequest(request),
});
```

## Policy engine

Policies are pure functions that receive the user, the action, the context, and the session.

```ts
import { createPolicy } from "@elurjs/auth";

auth.attachPolicy(
  createPolicy((user, action, context, session) => {
    if (!user) return false;

    if (action === "admin:dashboard") {
      return user.isAdmin === true;
    }

    if (action === "post:edit") {
      return user.permissions?.includes("post:edit") || user.id === context.authorId;
    }

    return false;
  }),
);
```

`auth.can(action, context?)` returns a reactive signal that re-evaluates when the user or the attached policies change.

### Policy helpers

```ts
import { hasRole, hasPermission, hasScope, isOwner, all, any, not } from "@elurjs/auth";

auth.attachPolicy(
  createPolicy((user, action, context) => {
    if (!user) return false;

    if (action === "admin:dashboard") {
      return hasRole("admin")(user, context);
    }

    if (action === "post:edit") {
      return any(
        hasPermission("post:edit"),
        isOwner("post", context.id),
      )(user, context);
    }

    if (action === "post:delete") {
      return all(
        hasRole("admin"),
        not(isOwner("post", context.id)),
      )(user, context);
    }

    return false;
  }),
);
```

### `rbacPolicy`

Convenience policy for role-based and permission-based access control.

```ts
import { rbacPolicy } from "@elurjs/auth";

auth.attachPolicy(
  rbacPolicy({
    resolveRoles: (user) => user.roles,
    resolvePermissions: (user) => user.permissions,
  }),
);

auth.can("role:admin").value;
auth.can("permission:post:edit").value;
```

#### Tenant support

For multi-tenant apps, pass `tenant` in the context and resolve roles/permissions per tenant:

```ts
auth.attachPolicy(
  rbacPolicy({
    resolveRoles: (user, tenant) => (tenant ? user.rolesByTenant[tenant] : user.roles),
    resolvePermissions: (user, tenant) => (tenant ? user.permissionsByTenant[tenant] : user.permissions),
  }),
);

auth.can("role:admin", { tenant: "acme" }).value;
auth.can("permission:post:edit", { tenant: "globex" }).value;
```

## Router integration

```ts
import { createRouter } from "@elurjs/core";
import { authRouterPlugin, requireAuth } from "@elurjs/auth";

const router = createRouter([
  { path: "/login", component: LoginPage, meta: { auth: "public" } },
  { path: "/admin", component: AdminPage, meta: { auth: { can: "admin:dashboard" } } },
  { path: "/post/:id/edit", component: EditPost, meta: { auth: { can: "post:edit" } } },
  { path: "/public", component: PublicPage, meta: { auth: false } },
  { path: "/profile", component: ProfilePage, meta: { auth: "optional" } },
]);

router.beforeEach(
  authRouterPlugin(auth, router, {
    public: ["/login", "/register"],
    defaultRedirect: "/login",
    fallbackRedirect: "/unauthorized",
  }),
);
```

### `meta.auth` DSL

The `meta.auth` field accepts:

- `"public"` or `false` — allow anyone.
- `"optional"` — allow the route, but auth is optional.
- `string` — action passed to `auth.can(action)`.
- `string[]` — any of the actions must be allowed.
- object:
  - `can` — action passed to `auth.can(action, context)`.
  - `context` — static context or a function returning context.
  - `role` — required role.
  - `roles` — any of the roles.
  - `permission` — required permission.
  - `permissions` — all of the permissions.
  - `provider` — required active provider.
  - `redirect` — custom redirect path.
  - `allow` — boolean or a guard function `(to, from, auth) => boolean \| string \| Promise<...>`.
- function — full custom guard `(to, from, auth) => NavigationGuardResult`.

### Dynamic context in routes

```ts
const router = createRouter([
  {
    path: "/post/:id/edit",
    component: EditPost,
    meta: {
      auth: {
        can: "post:edit",
        context: () => ({ id: router.params.value.id }),
      },
    },
  },
]);
```

### Standalone guards

```ts
import { requireAuth, requireRole, requirePermission, requireProvider, requirePolicy } from "@elurjs/auth";

router.beforeEach(requireAuth(auth, "/login"));
router.beforeEach(requireRole(auth, "admin", "/unauthorized"));
router.beforeEach(requirePermission(auth, "post:edit", "/unauthorized"));
router.beforeEach(requireProvider(auth, "apiKey", "/login"));
router.beforeEach(requirePolicy(auth, (to, from) => auth.can("custom:action", { path: to }).value));
```

### Custom meta interpreter

For advanced use cases, you can replace the default meta interpreter:

```ts
router.beforeEach(
  authRouterPlugin(auth, router, {
    interpretMeta(meta, auth, to, from) {
      if (!meta) return undefined;
      if (meta === "public") return undefined;
      if (typeof meta === "string") {
        return auth.can(meta).value ? undefined : "/unauthorized";
      }
      return undefined;
    },
  }),
);
```

## Optional provide/inject

```ts
import { provide } from "@elurjs/core";
import { AuthKey, useAuth, setActiveAuth } from "@elurjs/auth";

provide(AuthKey, auth);

// Or set globally for multi-tenant reactive switching:
setActiveAuth(auth);

// In a descendant component — useAuth() returns a reactive Signal:
const authSignal = useAuth();
// authSignal.value is the AuthInstance | undefined
if (authSignal.value) {
  console.log(authSignal.value.isAuthenticated.value);
}

// Non-reactive access (for guards, plugins):
import { getAuth } from "@elurjs/auth";
const auth = getAuth();
```

`useAuth()` returns a `Signal<AuthInstance | undefined>` that tracks the
active auth instance. When you call `setActiveAuth(newAuth)`, all components
using `useAuth()` re-render with the new instance — useful for multi-tenant
dynamic switching.

The library is fully usable without `provide/inject` if you prefer to export
the instance directly.

## Multi-provider

```ts
import { createAuth, credentialsProvider, mockDriver } from "@elurjs/auth";

const auth = createAuth({
  providers: {
    credentials: credentialsProvider({
      login: async (creds) => {
        const res = await fetch("/api/login", {
          method: "POST",
          body: JSON.stringify(creds),
        });
        return res.json();
      },
    }),
    apiKey: mockDriver({
      name: "apiKey",
      login: async (creds) => ({ user: { id: "2" }, token: creds.key }),
    }),
  },
  defaultProvider: "credentials",
  storage: localStorageAdapter({ key: "app:session" }),
});

await auth.login("credentials", { email, password });
await auth.login("apiKey", { key: "secret" });

console.log(auth.activeProvider.value); // "apiKey"
```

## Auto-refresh

When a driver provides `getExpiry`, the library can refresh the session before it expires.

```ts
const auth = createAuth({
  driver: jwtDriver({
    loginUrl: "/api/login",
    refreshUrl: "/api/refresh",
  }),
  autoRefresh: true, // default: 60 seconds before expiry
});
```

### Custom refresh schedule

For advanced control, provide a custom scheduler:

```ts
const auth = createAuth({
  driver,
  autoRefresh: {
    beforeExpirySeconds: 120,
    schedule(session, refresh) {
      const d = driver.getExpiry?.(session);
      if (!d) return () => {};
      const delay = Math.max(0, d - Date.now() - 120_000);
      const timer = setTimeout(() => void refresh(), delay);
      return () => clearTimeout(timer);
    },
  },
});
```

## Optional `elur-query` integration

`@elurjs/query` is an **optional** peer dependency. If you already use it, you can wrap auth-aware commands from the `./command` subpath.

```bash
npm install @elurjs/query
```

```ts
import { authCommand, createLoginCommand, createLogoutCommand, authHeaders } from "@elurjs/auth/command";

// Inject the current token into any command
const savePost = authCommand(auth, "post/save", async (payload, ctx) => {
  const res = await fetch("/api/posts", {
    method: "POST",
    headers: {
      ...authHeaders(auth),
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: ctx.signal,
  });
  return res.json();
});

// Or expose login/logout as commands
const login = createLoginCommand(auth, "auth/login");
const logout = createLogoutCommand(auth, "auth/logout");
```

## Testing

`mockDriver` makes the library easy to test without a real backend.

```ts
import { describe, it, expect } from "vitest";
import { createAuth, mockDriver } from "@elurjs/auth";

describe("auth", () => {
  it("logs in", async () => {
    const auth = createAuth({
      driver: mockDriver({
        login: () => Promise.resolve({ user: { id: "1", roles: ["admin"] }, token: "abc" }),
        toUser: (s) => s.user,
        getToken: (s) => s.token,
      }),
    });

    await auth.login({ email: "test@example.com", password: "secret" });

    expect(auth.isAuthenticated.value).toBe(true);
    expect(auth.user.value).toEqual({ id: "1", roles: ["admin"] });
    expect(auth.token.value).toBe("abc");
  });
});
```

## Best practices

- **Keep the core unopinionated**: do not put backend-specific logic outside the driver.
- **Use `toUser`**: always implement `toUser` if your session object wraps the user.
- **Prefer `can()` in templates**: `auth.can("post:edit").value` is reactive and efficient.
- **Separate policies**: split domain-specific rules into multiple policies instead of one giant function.
- **Custom redirect**: use `redirect` in `meta.auth` or a custom `interpretMeta` for route-specific behavior.
- **Do not store tokens in plain localStorage for production**: use `httpOnly` cookies when possible. Provide a `sessionCookieDriver` or custom driver that reads the cookie.
- **Never store JWTs in `cookieAdapter`**: cookies set via `document.cookie` are JS-accessible and XSS-vulnerable. Use `sessionCookieDriver` (httpOnly) instead.
- **Hydrate safely**: implement `hydrate` in the driver to validate the stored session on startup.
- **Enable multi-tab sync**: use `multiTabSync: { enabled: true }` so login/logout propagates across tabs.
- **Use `refreshOptions`**: configure retry behavior to avoid logging users out on transient network errors.

## TypeScript

`createAuth` accepts generics for `Session`, `User`, and `Credentials`:

```ts
interface MySession {
  user: MyUser;
  token: string;
  expiresAt: number;
}

interface MyUser {
  id: string;
  roles: string[];
  permissions: string[];
}

interface MyCredentials {
  email: string;
  password: string;
}

const auth = createAuth<MySession, MyUser, MyCredentials>({
  driver: myDriver,
});
```

The returned `AuthInstance` is typed accordingly.

## API overview

### Core

- `createAuth(options)` — reactive auth instance.
- `createAuthManager()` — manage multiple named auth instances.
- `auth.login(credentials)` / `auth.login("provider", credentials)`
- `auth.logout()` / `auth.refresh()` / `auth.ready()`
- `auth.session`, `auth.user`, `auth.token`, `auth.isAuthenticated`, `auth.isReady`, `auth.isLoading`, `auth.error`
- `auth.setSession(session)`, `auth.clearSession()`
- `auth.attachPolicy(policy)`, `auth.detachPolicy(policy)`
- `auth.can(action, context?)`, `auth.authorize(action, context?)`
- `auth.hasRole(role)`, `auth.hasPermission(permission)`, `auth.hasScope(scope)`
- `auth.hasAnyRole(roles)`, `auth.hasAllPermissions(permissions)`

### Drivers

- `jwtDriver(options)` — JWT / Bearer token flow.
- `sessionCookieDriver(options)` — `httpOnly` session cookie flow.
- `mockDriver(options)` — testing and prototyping.
- Custom driver via `AuthDriver` interface.

### Providers

- `credentialsProvider(options)` — email/password or custom credentials.
- `apiKeyProvider(options)` — API-key authentication.
- `oidcProvider(options)` — OIDC with PKCE.

### Storage adapters

- `localStorageAdapter({ key })`, `sessionStorageAdapter({ key })`, `cookieAdapter({ key })`, `memoryAdapter()`.

### Policy engine

- `createPolicy(evaluator)`
- `rbacPolicy(options)` — supports tenant-aware resolvers.
- `hasRole`, `hasPermission`, `hasScope`, `isOwner`, `all`, `any`, `not`.

### Router

- `authRouterPlugin(auth, router, options)`
- `requireAuth`, `requireRole`, `requirePermission`, `requireProvider`, `requirePolicy`.

### Optional command integration

From `@elurjs/auth/command`:

- `authCommand(auth, commandKey, executeFn, options?)`
- `createLoginCommand(auth, commandKey, options?)`
- `createLogoutCommand(auth, commandKey, options?)`
- `authHeaders(auth)`

## FAQ

### Does the library work without a router?

Yes. Use `auth.isAuthenticated` and `auth.can()` directly in your components.

### Can I use multiple auth instances in the same app?

Yes. Use `createAuthManager` for named instances or call `createAuth` multiple times directly.

### What happens if the session expires while the user is using the app?

If the driver implements `refresh` and `getExpiry`, and `autoRefresh` is enabled, the library will refresh the token automatically before expiry.

### How do I handle OAuth / OIDC?

Use the built-in `oidcProvider` for a basic PKCE flow, or write a custom driver that handles the redirect and callback.

### How do I integrate with `elur-query`?

Import `@elurjs/auth/command` and use `authCommand`, `createLoginCommand`, or `createLogoutCommand`.

## License

MIT
