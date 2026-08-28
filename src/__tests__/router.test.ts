import { describe, it, expect } from "vitest";
import { createRouter } from "@elurjs/core";
import { createAuth } from "../core/createAuth";
import { mockDriver } from "../drivers/mockDriver";
import { authRouterPlugin } from "../router/plugin";
import { requireAuth, requireRole, requirePermission } from "../router/guards";

describe("authRouterPlugin", () => {
  it("allows public routes", async () => {
    const driver = mockDriver({
      login: () => Promise.resolve({ user: { id: "1" } }),
      toUser: (s) => s.user as { id: string },
    });
    const auth = createAuth({ driver });
    const router = createRouter([
      { path: "/login", meta: { auth: "public" } },
      { path: "/admin", meta: { auth: { can: "admin" } } },
    ]);

    const guard = authRouterPlugin(auth, router, {
      public: ["/login"],
      defaultRedirect: "/login",
    });

    expect(await guard("/login", "")).toBeUndefined();
  });

  it("redirects unauthenticated users to defaultRedirect", async () => {
    const driver = mockDriver({
      login: () => Promise.resolve({ user: { id: "1" } }),
      toUser: (s) => s.user as { id: string },
    });
    const auth = createAuth({ driver });
    const router = createRouter([{ path: "/admin", meta: { auth: { can: "admin" } } }]);

    const guard = authRouterPlugin(auth, router, {
      defaultRedirect: "/login",
      fallbackRedirect: "/unauthorized",
    });

    expect(await guard("/admin", "")).toBe("/login");
  });

  it("checks can() action for authenticated users", async () => {
    const driver = mockDriver({
      login: () => Promise.resolve({ user: { id: "1", roles: ["admin"] } }),
      toUser: (s) => s.user as { id: string; roles: string[] },
    });
    const auth = createAuth({ driver });
    auth.attachPolicy(
      createAuthPolicy((user, action) => {
        if (!user) return false;
        if (action === "admin" && (user as { roles: string[] }).roles.includes("admin")) return true;
        return false;
      }),
    );

    await auth.login({});

    const router = createRouter([
      { path: "/admin", meta: { auth: { can: "admin" } } },
      { path: "/user", meta: { auth: { can: "user" } } },
    ]);

    const guard = authRouterPlugin(auth, router, {
      defaultRedirect: "/login",
      fallbackRedirect: "/unauthorized",
    });

    expect(await guard("/admin", "")).toBeUndefined();
    expect(await guard("/user", "")).toBe("/unauthorized");
  });

  it("supports role meta", async () => {
    const driver = mockDriver({
      login: () => Promise.resolve({ user: { id: "1", roles: ["admin"] } }),
      toUser: (s) => s.user as { id: string; roles: string[] },
    });
    const auth = createAuth({ driver, identity: { roles: "roles" } });
    await auth.login({});

    const router = createRouter([{ path: "/admin", meta: { auth: { role: "admin" } } }]);
    const guard = authRouterPlugin(auth, router, {
      defaultRedirect: "/login",
      fallbackRedirect: "/unauthorized",
    });

    expect(await guard("/admin", "")).toBeUndefined();
  });

  it("supports permission meta", async () => {
    const driver = mockDriver({
      login: () => Promise.resolve({ user: { id: "1", permissions: ["post:edit"] } }),
      toUser: (s) => s.user as { id: string; permissions: string[] },
    });
    const auth = createAuth({ driver, identity: { permissions: "permissions" } });
    await auth.login({});

    const router = createRouter([{ path: "/post", meta: { auth: { permission: "post:edit" } } }]);
    const guard = authRouterPlugin(auth, router, {
      defaultRedirect: "/login",
      fallbackRedirect: "/unauthorized",
    });

    expect(await guard("/post", "")).toBeUndefined();
  });
});

function createAuthPolicy(
  evaluator: (user: unknown, action: string) => boolean,
) {
  return {
    evaluate(user: unknown, action: string) {
      return evaluator(user, action);
    },
  };
}

describe("standalone guards", () => {
  it("requireAuth redirects when not authenticated", async () => {
    const auth = createAuth({
      driver: mockDriver({
        login: () => Promise.resolve({ user: { id: "1" } }),
        toUser: (s) => s.user as { id: string },
      }),
    });

    const guard = requireAuth(auth, "/login");
    expect(await guard("/", "")).toBe("/login");

    await auth.login({});
    expect(await guard("/", "")).toBeUndefined();
  });

  it("requireRole checks role", async () => {
    const auth = createAuth({
      driver: mockDriver({
        login: () => Promise.resolve({ user: { id: "1", roles: ["admin"] } }),
        toUser: (s) => s.user as { id: string; roles: string[] },
      }),
      identity: { roles: "roles" },
    });
    await auth.login({});

    const guard = requireRole(auth, "admin", "/unauthorized");
    expect(await guard("/", "")).toBeUndefined();

    const failing = requireRole(auth, "user", "/unauthorized");
    expect(await failing("/", "")).toBe("/unauthorized");
  });

  it("requirePermission checks permission", async () => {
    const auth = createAuth({
      driver: mockDriver({
        login: () => Promise.resolve({ user: { id: "1", permissions: ["post:edit"] } }),
        toUser: (s) => s.user as { id: string; permissions: string[] },
      }),
      identity: { permissions: "permissions" },
    });
    await auth.login({});

    const guard = requirePermission(auth, "post:edit", "/unauthorized");
    expect(await guard("/", "")).toBeUndefined();

    const failing = requirePermission(auth, "post:delete", "/unauthorized");
    expect(await failing("/", "")).toBe("/unauthorized");
  });
});
