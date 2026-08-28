import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createAuth } from "../core/createAuth";
import { createAuthManager } from "../core/authManager";
import { mockDriver } from "../drivers/mockDriver";
import { memoryAdapter } from "../storage/memoryAdapter";
import { cookieAdapter } from "../storage/cookieAdapter";
import { useAuth, setActiveAuth, getAuth } from "../inject";
import { createRouter } from "@elurjs/core";
import { authRouterPlugin } from "../router/plugin";
import { oidcProvider } from "../providers/oidcProvider";
import type { OidcSession } from "../providers/oidcProvider";

// ─────────────────────────────────────────────────────────────────────────────
// Fix #1 — refresh() distinguishes network errors from 401/403
// ─────────────────────────────────────────────────────────────────────────────

describe("Fix #1: refresh() — transient vs auth errors", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does NOT logout on transient network error (500) — retries and succeeds", async () => {
    let refreshCalls = 0;
    const driver = mockDriver({
      login: () => Promise.resolve({ user: { id: "1" }, token: "abc" }),
      refresh: () => {
        refreshCalls++;
        if (refreshCalls < 3) {
          const err = new Error("server error") as Error & { status?: number };
          err.status = 500;
          throw err;
        }
        return Promise.resolve({ user: { id: "1" }, token: "new-token" });
      },
      toUser: (s) => s.user as { id: string },
      getToken: (s) => s.token as string,
    });

    const auth = createAuth({
      driver,
      refreshOptions: { maxRetries: 5, retryDelay: 10 },
    });

    await auth.login({ email: "test@test.com", password: "123" });
    expect(auth.isAuthenticated.value).toBe(true);
    expect(auth.token.value).toBe("abc");

    // Start refresh — will fail twice with 500, then succeed.
    const refreshPromise = auth.refresh();

    // Advance timers for retries (2 retries × 10ms delay).
    await vi.advanceTimersByTimeAsync(50);
    await refreshPromise;

    expect(auth.isAuthenticated.value).toBe(true);
    expect(auth.token.value).toBe("new-token");
    expect(refreshCalls).toBe(3);
  });

  it("DOES logout on 401 auth error", async () => {
    const driver = mockDriver({
      login: () => Promise.resolve({ user: { id: "1" }, token: "abc" }),
      refresh: () => {
        const err = new Error("unauthorized") as Error & { status?: number };
        err.status = 401;
        throw err;
      },
      toUser: (s) => s.user as { id: string },
      getToken: (s) => s.token as string,
    });

    const auth = createAuth({ driver });

    await auth.login({ email: "test@test.com", password: "123" });
    expect(auth.isAuthenticated.value).toBe(true);

    await expect(auth.refresh()).rejects.toThrow("unauthorized");

    expect(auth.isAuthenticated.value).toBe(false);
    expect(auth.session.value).toBeNull();
  });

  it("DOES logout on 403 auth error", async () => {
    const driver = mockDriver({
      login: () => Promise.resolve({ user: { id: "1" }, token: "abc" }),
      refresh: () => {
        const err = new Error("forbidden") as Error & { status?: number };
        err.status = 403;
        throw err;
      },
      toUser: (s) => s.user as { id: string },
    });

    const auth = createAuth({ driver });

    await auth.login({ email: "test@test.com", password: "123" });
    expect(auth.isAuthenticated.value).toBe(true);

    await expect(auth.refresh()).rejects.toThrow("forbidden");
    expect(auth.isAuthenticated.value).toBe(false);
  });

  it("keeps stale session when max retries exhausted on transient error", async () => {
    let refreshCalls = 0;
    const driver = mockDriver({
      login: () => Promise.resolve({ user: { id: "1" }, token: "abc" }),
      refresh: () => {
        refreshCalls++;
        const err = new Error("server error") as Error & { status?: number };
        err.status = 503;
        throw err;
      },
      toUser: (s) => s.user as { id: string },
      getToken: (s) => s.token as string,
    });

    const auth = createAuth({
      driver,
      refreshOptions: { maxRetries: 2, retryDelay: 10 },
    });

    await auth.login({ email: "test@test.com", password: "123" });
    expect(auth.token.value).toBe("abc");

    // Attach rejection handler immediately to prevent unhandled rejection.
    const refreshPromise = auth.refresh().catch((err: unknown) => err);
    // Advance timers for retries (2 retries × 10ms).
    await vi.advanceTimersByTimeAsync(50);
    const result = await refreshPromise;
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toBe("server error");

    // Session is kept as stale — user still has access.
    expect(auth.isAuthenticated.value).toBe(true);
    expect(auth.token.value).toBe("abc");
    expect(refreshCalls).toBe(3); // initial + 2 retries
  });

  it("treats TypeError as transient (network failure)", async () => {
    let refreshCalls = 0;
    const driver = mockDriver({
      login: () => Promise.resolve({ user: { id: "1" }, token: "abc" }),
      refresh: () => {
        refreshCalls++;
        if (refreshCalls < 2) {
          throw new TypeError("Failed to fetch");
        }
        return Promise.resolve({ user: { id: "1" }, token: "recovered" });
      },
      toUser: (s) => s.user as { id: string },
      getToken: (s) => s.token as string,
    });

    const auth = createAuth({
      driver,
      refreshOptions: { maxRetries: 3, retryDelay: 10 },
    });

    await auth.login({ email: "test@test.com", password: "123" });

    const p = auth.refresh().catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(30);
    await p;

    expect(auth.token.value).toBe("recovered");
    expect(auth.isAuthenticated.value).toBe(true);
  });

  it("supports custom isTransientError predicate", async () => {
    let refreshCalls = 0;
    const driver = mockDriver({
      login: () => Promise.resolve({ user: { id: "1" }, token: "abc" }),
      refresh: () => {
        refreshCalls++;
        const err = new Error("custom") as Error & { code?: string };
        err.code = "CUSTOM_TRANSIENT";
        throw err;
      },
      toUser: (s) => s.user as { id: string },
    });

    const auth = createAuth({
      driver,
      refreshOptions: {
        maxRetries: 1,
        retryDelay: 10,
        isTransientError: (err) => (err as { code?: string }).code === "CUSTOM_TRANSIENT",
      },
    });

    await auth.login({ email: "test@test.com", password: "123" });
    expect(auth.isAuthenticated.value).toBe(true);

    // Attach rejection handler immediately to prevent unhandled rejection.
    const p = auth.refresh().catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(30);
    const result = await p;
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toBe("custom");

    // Custom transient → session kept, not logged out.
    expect(auth.isAuthenticated.value).toBe(true);
    expect(refreshCalls).toBe(2); // initial + 1 retry
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fix #2 — AuthManager remove/clear calls dispose()
// ─────────────────────────────────────────────────────────────────────────────

describe("Fix #2: AuthManager dispose on remove/clear", () => {
  it("remove() calls dispose() on the instance", () => {
    const manager = createAuthManager();
    const auth = manager.create("test", {
      driver: mockDriver({
        login: () => Promise.resolve({ user: { id: "1" }, expiresAt: Date.now() + 60000 }),
        toUser: (s) => s.user as { id: string },
        getExpiry: (s) => (s as { expiresAt: number }).expiresAt,
      }),
      autoRefresh: true,
    });

    const disposeSpy = vi.spyOn(auth, "dispose");

    manager.remove("test");

    expect(disposeSpy).toHaveBeenCalledOnce();
    expect(manager.has("test")).toBe(false);
  });

  it("clear() calls dispose() on all instances", () => {
    const manager = createAuthManager();
    const auth1 = manager.create("a", {
      driver: mockDriver({ login: () => Promise.resolve({ user: { id: "1" } }), toUser: (s) => s.user as { id: string } }),
    });
    const auth2 = manager.create("b", {
      driver: mockDriver({ login: () => Promise.resolve({ user: { id: "2" } }), toUser: (s) => s.user as { id: string } }),
    });

    const spy1 = vi.spyOn(auth1, "dispose");
    const spy2 = vi.spyOn(auth2, "dispose");

    manager.clear();

    expect(spy1).toHaveBeenCalledOnce();
    expect(spy2).toHaveBeenCalledOnce();
    expect(manager.list()).toEqual([]);
  });

  it("remove() on non-existent name does nothing (no throw)", () => {
    const manager = createAuthManager();
    expect(() => manager.remove("nonexistent")).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fix #3 — ready() doesn't cache rejected promise, supports force
// ─────────────────────────────────────────────────────────────────────────────

describe("Fix #3: ready() — rejection handling and force option", () => {
  it("does not cache rejected promise — allows retry", async () => {
    let hydrateCalls = 0;
    const storage = {
      get: () => {
        hydrateCalls++;
        if (hydrateCalls === 1) {
          return Promise.reject(new Error("storage unavailable"));
        }
        return Promise.resolve(null);
      },
      set: () => { },
      remove: () => { },
    };

    const auth = createAuth({
      driver: mockDriver({ login: () => Promise.resolve({ user: { id: "1" } }), toUser: (s) => s.user as { id: string } }),
      storage,
    });

    // First ready() should reject.
    await expect(auth.ready()).rejects.toThrow("storage unavailable");

    // Second ready() should retry (not return cached rejection).
    await expect(auth.ready()).resolves.toBeUndefined();
    expect(hydrateCalls).toBe(2);
  });

  it("ready({ force: true }) forces re-hydration", async () => {
    let hydrateCalls = 0;
    const storage = memoryAdapter();
    const originalGet = storage.get.bind(storage);
    storage.get = () => {
      hydrateCalls++;
      return originalGet();
    };

    const auth = createAuth({
      driver: mockDriver({ login: () => Promise.resolve({ user: { id: "1" } }), toUser: (s) => s.user as { id: string } }),
      storage,
    });

    // Initial ready() — hydrates.
    await auth.ready();
    expect(hydrateCalls).toBeGreaterThanOrEqual(1);
    const callsAfterFirst = hydrateCalls;

    // ready() without force — returns immediately (already ready).
    await auth.ready();
    expect(hydrateCalls).toBe(callsAfterFirst);

    // ready({ force: true }) — re-hydrates.
    await auth.ready({ force: true });
    expect(hydrateCalls).toBeGreaterThan(callsAfterFirst);
  });

  it("ready() resolves immediately when already ready", async () => {
    const auth = createAuth({
      driver: mockDriver({ login: () => Promise.resolve({ user: { id: "1" } }), toUser: (s) => s.user as { id: string } }),
    });

    await auth.ready();
    const start = Date.now();
    await auth.ready();
    expect(Date.now() - start).toBeLessThan(50);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fix #4 — cookieAdapter security warning
// ─────────────────────────────────────────────────────────────────────────────

describe("Fix #4: cookieAdapter security warning", () => {
  it("emits console.warn by default", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => { });

    cookieAdapter({ key: "test-session" });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("cookieAdapter stores data in document.cookie"),
    );

    warnSpy.mockRestore();
  });

  it("suppresses warning when suppressSecurityWarning is true", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => { });

    cookieAdapter({ key: "test-session", suppressSecurityWarning: true });

    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it("still works functionally with suppressSecurityWarning", () => {
    const adapter = cookieAdapter({ key: "test-fn", suppressSecurityWarning: true });

    adapter.set({ token: "abc" } as never);
    const result = adapter.get();
    expect(result).toEqual({ token: "abc" });

    adapter.remove();
    expect(adapter.get()).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fix #5 — authRouterPlugin meta cache
// ─────────────────────────────────────────────────────────────────────────────

describe("Fix #5: authRouterPlugin meta cache", () => {
  it("caches meta resolution when metaCacheTtl > 0", async () => {
    let metaCallCount = 0;
    const auth = createAuth({
      driver: mockDriver({
        login: () => Promise.resolve({ user: { id: "1", roles: ["admin"] } }),
        toUser: (s) => s.user as { id: string; roles: string[] },
      }),
    });
    await auth.login({});

    const router = createRouter([
      { path: "/admin", meta: { auth: { can: "admin" } } },
    ]);

    const customInterpreter = () => {
      metaCallCount++;
      return undefined as unknown as void;
    };

    const guard = authRouterPlugin(auth, router, {
      defaultRedirect: "/login",
      fallbackRedirect: "/unauthorized",
      interpretMeta: customInterpreter as never,
      metaCacheTtl: 5000,
    });

    // First navigation — calls interpreter.
    await guard("/admin", "");
    expect(metaCallCount).toBe(1);

    // Second navigation to same path — should use cache.
    await guard("/admin", "");
    expect(metaCallCount).toBe(1); // not called again

    // Different path — calls interpreter.
    await guard("/dashboard", "");
    expect(metaCallCount).toBe(2);
  });

  it("does not cache when metaCacheTtl is 0 (default)", async () => {
    let metaCallCount = 0;
    const auth = createAuth({
      driver: mockDriver({
        login: () => Promise.resolve({ user: { id: "1" } }),
        toUser: (s) => s.user as { id: string },
      }),
    });
    await auth.login({});

    const router = createRouter([
      { path: "/page", meta: { auth: "optional" } },
    ]);

    const customInterpreter = () => {
      metaCallCount++;
      return undefined as unknown as void;
    };

    const guard = authRouterPlugin(auth, router, {
      interpretMeta: customInterpreter as never,
    });

    await guard("/page", "");
    await guard("/page", "");
    expect(metaCallCount).toBe(2);
  });

  it("cache expires after TTL", async () => {
    vi.useFakeTimers();
    let metaCallCount = 0;
    const auth = createAuth({
      driver: mockDriver({
        login: () => Promise.resolve({ user: { id: "1" } }),
        toUser: (s) => s.user as { id: string },
      }),
    });
    await auth.login({});

    const router = createRouter([
      { path: "/page", meta: { auth: "optional" } },
    ]);

    const customInterpreter = () => {
      metaCallCount++;
      return undefined as unknown as void;
    };

    const guard = authRouterPlugin(auth, router, {
      interpretMeta: customInterpreter as never,
      metaCacheTtl: 100,
    });

    await guard("/page", "");
    expect(metaCallCount).toBe(1);

    // Before TTL expires — cached.
    await guard("/page", "");
    expect(metaCallCount).toBe(1);

    // Advance past TTL.
    vi.advanceTimersByTime(150);

    await guard("/page", "");
    expect(metaCallCount).toBe(2);

    vi.useRealTimers();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fix #6 — useAuth is reactive
// ─────────────────────────────────────────────────────────────────────────────

describe("Fix #6: useAuth reactive", () => {
  afterEach(() => {
    setActiveAuth(undefined);
  });

  it("useAuth returns a Signal that tracks setActiveAuth", () => {
    const auth1 = createAuth({
      driver: mockDriver({ login: () => Promise.resolve({ user: { id: "1" } }), toUser: (s) => s.user as { id: string } }),
      name: "tenant-a",
    });
    const auth2 = createAuth({
      driver: mockDriver({ login: () => Promise.resolve({ user: { id: "2" } }), toUser: (s) => s.user as { id: string } }),
      name: "tenant-b",
    });

    const authSignal = useAuth();

    expect(authSignal.value).toBeUndefined();

    setActiveAuth(auth1);
    expect(authSignal.value).toBe(auth1);
    expect(authSignal.value?.name).toBe("tenant-a");

    setActiveAuth(auth2);
    expect(authSignal.value).toBe(auth2);
    expect(authSignal.value?.name).toBe("tenant-b");

    setActiveAuth(undefined);
    expect(authSignal.value).toBeUndefined();
  });

  it("getAuth returns current instance non-reactively", () => {
    const auth = createAuth({
      driver: mockDriver({ login: () => Promise.resolve({ user: { id: "1" } }), toUser: (s) => s.user as { id: string } }),
    });

    setActiveAuth(auth);
    expect(getAuth()).toBe(auth);

    setActiveAuth(undefined);
    expect(getAuth()).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fix #7 — Multi-tab sync via BroadcastChannel
// ─────────────────────────────────────────────────────────────────────────────

describe("Fix #7: Multi-tab sync via BroadcastChannel", () => {
  // No fake timers in this block — use real timers for BroadcastChannel.

  it("broadcasts login to other tabs", async () => {
    const channelName = "elur-auth:test-login-" + Date.now();
    const receivedMessages: Array<{ type: string; session: unknown }> = [];

    const otherTabChannel = new BroadcastChannel(channelName);
    otherTabChannel.addEventListener("message", (event) => {
      receivedMessages.push(event.data as { type: string; session: unknown });
    });

    const auth = createAuth({
      driver: mockDriver({
        login: () => Promise.resolve({ user: { id: "1" }, token: "abc" }),
        toUser: (s) => s.user as { id: string },
      }),
      multiTabSync: { enabled: true, channelName },
    });

    await auth.login({ email: "test@test.com", password: "123" });

    // Wait for message delivery.
    await new Promise((r) => setTimeout(r, 50));

    expect(receivedMessages.length).toBeGreaterThanOrEqual(1);
    expect(receivedMessages[0].type).toBe("auth:login");
    expect(receivedMessages[0].session).toEqual({ user: { id: "1" }, token: "abc" });

    otherTabChannel.close();
    auth.dispose();
  });

  it("broadcasts logout to other tabs", async () => {
    const channelName = "elur-auth:test-logout-" + Date.now();
    const receivedMessages: Array<{ type: string; session: unknown }> = [];

    const otherTabChannel = new BroadcastChannel(channelName);
    otherTabChannel.addEventListener("message", (event) => {
      receivedMessages.push(event.data as { type: string; session: unknown });
    });

    const auth = createAuth({
      driver: mockDriver({
        login: () => Promise.resolve({ user: { id: "1" }, token: "abc" }),
        toUser: (s) => s.user as { id: string },
      }),
      multiTabSync: { enabled: true, channelName },
    });

    await auth.login({ email: "test@test.com", password: "123" });
    await auth.logout();

    await new Promise((r) => setTimeout(r, 50));

    const logoutMessage = receivedMessages.find((m) => m.type === "auth:logout");
    expect(logoutMessage).toBeDefined();
    expect(logoutMessage!.session).toBeNull();

    otherTabChannel.close();
    auth.dispose();
  });

  it("receives login from other tabs and syncs session", async () => {
    const channelName = "elur-auth:test-receive-" + Date.now();

    const auth = createAuth({
      driver: mockDriver({
        login: () => Promise.resolve({ user: { id: "1" } }),
        toUser: (s) => s.user as { id: string },
      }),
      storage: memoryAdapter(),
      multiTabSync: { enabled: true, channelName },
    });

    await auth.ready();
    expect(auth.isAuthenticated.value).toBe(false);

    // Simulate another tab broadcasting a login.
    const otherTabChannel = new BroadcastChannel(channelName);
    otherTabChannel.postMessage({
      type: "auth:login",
      session: { user: { id: "99", name: "Synced User" }, token: "synced-token" },
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(auth.isAuthenticated.value).toBe(true);
    expect(auth.user.value).toEqual({ id: "99", name: "Synced User" });

    otherTabChannel.close();
    auth.dispose();
  });

  it("receives logout from other tabs and clears session", async () => {
    const channelName = "elur-auth:test-receive-logout-" + Date.now();

    const auth = createAuth({
      driver: mockDriver({
        login: () => Promise.resolve({ user: { id: "1" }, token: "abc" }),
        toUser: (s) => s.user as { id: string },
        getToken: (s) => s.token as string,
      }),
      multiTabSync: { enabled: true, channelName },
    });

    await auth.login({ email: "test@test.com", password: "123" });
    expect(auth.isAuthenticated.value).toBe(true);

    const otherTabChannel = new BroadcastChannel(channelName);
    otherTabChannel.postMessage({ type: "auth:logout", session: null });

    await new Promise((r) => setTimeout(r, 50));

    expect(auth.isAuthenticated.value).toBe(false);
    expect(auth.session.value).toBeNull();

    otherTabChannel.close();
    auth.dispose();
  });

  it("does not broadcast when multiTabSync is disabled (default)", async () => {
    const channelName = "elur-auth:test-no-sync-" + Date.now();
    const receivedMessages: unknown[] = [];

    const otherTabChannel = new BroadcastChannel(channelName);
    otherTabChannel.addEventListener("message", (event) => {
      receivedMessages.push(event.data);
    });

    const auth = createAuth({
      driver: mockDriver({
        login: () => Promise.resolve({ user: { id: "1" } }),
        toUser: (s) => s.user as { id: string },
      }),
    });

    await auth.login({ email: "test@test.com", password: "123" });
    await new Promise((r) => setTimeout(r, 50));

    expect(receivedMessages.length).toBe(0);

    otherTabChannel.close();
    auth.dispose();
  });

  it("does not re-broadcast messages it received (prevents loops)", async () => {
    const channelName = "elur-auth:test-no-loop-" + Date.now();
    let messagesReceived = 0;

    const auth = createAuth({
      driver: mockDriver({
        login: () => Promise.resolve({ user: { id: "1" } }),
        toUser: (s) => s.user as { id: string },
      }),
      multiTabSync: { enabled: true, channelName },
    });

    const monitorChannel = new BroadcastChannel(channelName);
    monitorChannel.addEventListener("message", () => {
      messagesReceived++;
    });

    // Send a login from another tab.
    const senderChannel = new BroadcastChannel(channelName);
    senderChannel.postMessage({ type: "auth:login", session: { user: { id: "1" } } });

    await new Promise((r) => setTimeout(r, 100));

    // Should have received exactly 1 message (the original), not a re-broadcast.
    expect(messagesReceived).toBe(1);

    monitorChannel.close();
    senderChannel.close();
    auth.dispose();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fix #8 — oidcProvider.performLogout
// ─────────────────────────────────────────────────────────────────────────────

describe("Fix #8: oidcProvider.performLogout", () => {
  function createMockOidcProvider() {
    const mockFetcher = vi.fn(async (input: RequestInfo) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes(".well-known/openid-configuration")) {
        return new Response(
          JSON.stringify({
            authorization_endpoint: "https://idp.example.com/authorize",
            token_endpoint: "https://idp.example.com/token",
            end_session_endpoint: "https://idp.example.com/logout",
            userinfo_endpoint: "https://idp.example.com/userinfo",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("{}", { status: 200 });
    });

    const provider = oidcProvider({
      authority: "https://idp.example.com",
      clientId: "test-client",
      redirectUri: "https://app.example.com/callback",
      postLogoutRedirectUri: "https://app.example.com/",
      fetcher: mockFetcher as never,
    });

    return { provider, mockFetcher };
  }

  it("performLogout redirects to end_session_endpoint by default", async () => {
    const { provider } = createMockOidcProvider();

    const session: OidcSession = {
      user: { id: "1" } as never,
      idToken: "test-id-token",
      accessToken: "test-access-token",
      claims: {},
    };

    let redirectedUrl: string | undefined;
    await provider.performLogout(session, {
      redirect: (url) => {
        redirectedUrl = url;
      },
    });

    expect(redirectedUrl).toContain("https://idp.example.com/logout");
    expect(redirectedUrl).toContain("id_token_hint=test-id-token");
    expect(redirectedUrl).toContain("post_logout_redirect_uri=");
  });

  it("performLogout with mode=fetch does background request", async () => {
    const { provider, mockFetcher } = createMockOidcProvider();

    const session: OidcSession = {
      user: { id: "1" } as never,
      idToken: "test-id-token",
      accessToken: "test-access-token",
      claims: {},
    };

    await provider.performLogout(session, { mode: "fetch" });

    const logoutCall = mockFetcher.mock.calls.find(
      (call) => typeof call[0] === "string" && (call[0] as string).includes("logout"),
    );
    expect(logoutCall).toBeDefined();
  });

  it("performLogout without idToken still works", async () => {
    const { provider } = createMockOidcProvider();

    const session: OidcSession = {
      user: { id: "1" } as never,
      idToken: "",
      accessToken: "test-access-token",
      claims: {},
    };

    let redirectedUrl: string | undefined;
    await provider.performLogout(session, {
      redirect: (url) => {
        redirectedUrl = url;
      },
    });

    expect(redirectedUrl).toContain("https://idp.example.com/logout");
    expect(redirectedUrl).not.toContain("id_token_hint");
  });

  it("performLogout throws when no redirect function and no window.location", async () => {
    const { provider } = createMockOidcProvider();

    const session: OidcSession = {
      user: { id: "1" } as never,
      idToken: "test-id-token",
      accessToken: "test-access-token",
      claims: {},
    };

    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "location");
    try {
      // @ts-expect-error — intentionally removing location
      delete globalThis.location;
      await expect(
        provider.performLogout(session, { mode: "redirect" }),
      ).rejects.toThrow("no redirect function");
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(globalThis, "location", originalDescriptor);
      }
    }
  });

  it("logout() (the driver method) is still a no-op for backward compatibility", async () => {
    const { provider } = createMockOidcProvider();

    const session: OidcSession = {
      user: { id: "1" } as never,
      idToken: "test-id-token",
      accessToken: "test-access-token",
      claims: {},
    };

    await expect(provider.logout(session)).resolves.toBeUndefined();
  });
});
