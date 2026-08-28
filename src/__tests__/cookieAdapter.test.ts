import { describe, it, expect } from "vitest";
import { cookieAdapter } from "../storage/cookieAdapter";

describe("cookieAdapter", () => {
  it("persists and retrieves session from document.cookie", () => {
    const storage = cookieAdapter({ key: "elur-auth-test", days: 1 });
    const session = { user: { id: "1" } };

    storage.set(session);
    const retrieved = storage.get();

    expect(retrieved).toEqual(session);

    storage.remove();
    expect(storage.get()).toBeNull();
  });
});
