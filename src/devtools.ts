/**
 * @elurjs/auth/devtools — dev-only entry point.
 *
 * Registers an `Auth` plugin on the elur DevTools backend hook
 * (`window.__ELUR_DEVTOOLS_HOOK__`) exposing every live auth instance:
 * authentication state, active provider and user. Tokens and session
 * credentials are NEVER exposed. Only loaded when explicitly imported
 * (the Vite plugin injects it in dev mode); never bundled into production
 * apps.
 */
import type { AuthInstance } from "./core/types";

export interface AuthInstanceSnapshot {
    name: string;
    isAuthenticated: boolean;
    isAnonymous: boolean;
    isReady: boolean;
    isLoading: boolean;
    activeProvider: string | null;
    /** Truncated JSON preview of the user object (never the token/session). */
    userPreview: string | null;
    /** Error message, if any. */
    error: string | null;
}

export interface AuthDevtoolsSnapshot {
    instances: AuthInstanceSnapshot[];
}

const _instancesKey = Symbol.for("@elurjs/auth/instances");

type AnyAuthInstance = AuthInstance<unknown, unknown, unknown>;

function getInstances(): AnyAuthInstance[] {
    const set = (globalThis as Record<PropertyKey, unknown>)[_instancesKey] as
        | Set<AnyAuthInstance>
        | undefined;
    return set ? Array.from(set) : [];
}

function preview(value: unknown): string {
    try {
        const json = JSON.stringify(value);
        if (json === undefined) return String(value);
        return json.length > 200 ? json.slice(0, 200) + "…" : json;
    } catch {
        return "[unserializable]";
    }
}

function errorMessage(error: unknown): string | null {
    if (error == null) return null;
    if (error instanceof Error) return error.message;
    return preview(error);
}

/** Builds a JSON-safe snapshot of all registered auth instances. */
export function getAuthDevtoolsSnapshot(): AuthDevtoolsSnapshot {
    const instances = getInstances().map((auth) => ({
        name: auth.name,
        isAuthenticated: auth.isAuthenticated.value,
        isAnonymous: auth.isAnonymous.value,
        isReady: auth.isReady.value,
        isLoading: auth.isLoading.value,
        activeProvider: auth.activeProvider.value,
        userPreview: auth.user.value == null ? null : preview(auth.user.value),
        error: errorMessage(auth.error.value),
    }));
    return { instances };
}

const descriptor = {
    id: "@elurjs/auth",
    label: "Auth",
    getSnapshot: getAuthDevtoolsSnapshot,
};

declare global {
    interface Window {
        __ELUR_DEVTOOLS_HOOK__?: {
            version: number;
            registerPlugin(plugin: {
                id: string;
                label?: string;
                getSnapshot?(): unknown;
            }): () => void;
        };
        __ELUR_DEVTOOLS_PENDING_PLUGINS__?: Array<typeof descriptor>;
    }
}

if (typeof window !== "undefined") {
    const hook = window.__ELUR_DEVTOOLS_HOOK__;
    if (hook) hook.registerPlugin(descriptor);
    else (window.__ELUR_DEVTOOLS_PENDING_PLUGINS__ ??= []).push(descriptor);
}
