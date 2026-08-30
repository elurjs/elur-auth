import { describe, expect, it } from "vitest";
import { createAuth, mockDriver } from "../index";
import { getAuthDevtoolsSnapshot } from "../devtools";

describe("devtools plugin", () => {
    it("exposes live auth instances without leaking tokens", async () => {
        const auth = createAuth({
            name: "devtools-test",
            driver: mockDriver(),
            providers: {},
        });

        const snapshot = getAuthDevtoolsSnapshot();
        const instance = snapshot.instances.find((i) => i.name === "devtools-test");
        expect(instance).toBeDefined();
        expect(instance?.isAuthenticated).toBe(false);
        expect(instance?.isLoading).toBe(false);

        const raw = JSON.stringify(snapshot);
        expect(raw).not.toContain("token");

        auth.dispose();

        const after = getAuthDevtoolsSnapshot();
        expect(after.instances.find((i) => i.name === "devtools-test")).toBeUndefined();
    });
});
