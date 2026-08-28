import type { AuthDriver } from "../core/types";

export interface OidcProviderOptions {
  authority: string;
  clientId: string;
  redirectUri: string;
  postLogoutRedirectUri?: string;
  responseType?: string;
  scope?: string;
  fetcher?: (input: RequestInfo, init?: RequestInit) => Promise<Response>;
}

export interface OidcCredentials {
  code: string;
  codeVerifier: string;
  state?: string;
  nonce?: string;
}

export interface OidcSession<User = unknown> {
  user: User;
  idToken: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  claims: Record<string, unknown>;
}

export interface OidcLoginUrl {
  url: string;
  state: string;
  codeVerifier: string;
  nonce: string;
}

export interface OidcProvider<User = unknown>
  extends AuthDriver<OidcSession<User>, User, OidcCredentials> {
  buildLoginUrl(): Promise<OidcLoginUrl>;
  buildLogoutUrl(idToken?: string): Promise<string>;
  resolveMetadata(): Promise<Record<string, unknown>>;
  /**
   * Builds the end_session URL and performs the redirect (or fetch) to
   * log the user out from the OIDC provider. Cleans up local state.
   * (Fix #8)
   */
  performLogout(session: OidcSession<User>, options?: {
    /** Redirect mode: "redirect" (default) navigates the browser, "fetch" does a background request. */
    mode?: "redirect" | "fetch";
    /** Custom redirect implementation (defaults to window.location.href). */
    redirect?: (url: string) => void;
  }): Promise<void>;
}

function hasCrypto(): boolean {
  return typeof globalThis !== "undefined" && "crypto" in globalThis;
}

function randomBytes(length: number): Uint8Array {
  if (!hasCrypto()) {
    throw new Error("[elur-auth] OIDC provider requires Web Crypto API.");
  }
  return globalThis.crypto.getRandomValues(new Uint8Array(length));
}

function base64UrlEncode(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : input;
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function generateRandomString(length: number): string {
  const bytes = randomBytes(length);
  return base64UrlEncode(bytes);
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  if (!hasCrypto()) {
    throw new Error("[elur-auth] OIDC provider requires Web Crypto API.");
  }
  const data = new TextEncoder().encode(verifier);
  const hash = await globalThis.crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(hash);
}

function parseJwt(token: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("[elur-auth] Invalid JWT token.");
  }
  const payload = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
  return JSON.parse(payload) as Record<string, unknown>;
}

export function oidcProvider<User = unknown>(
  options: OidcProviderOptions,
): OidcProvider<User> {
  const {
    authority,
    clientId,
    redirectUri,
    postLogoutRedirectUri,
    responseType = "code",
    scope = "openid profile email",
    fetcher = globalThis.fetch.bind(globalThis),
  } = options;

  let metadataPromise: Promise<Record<string, unknown>> | null = null;

  async function resolveMetadata(): Promise<Record<string, unknown>> {
    if (metadataPromise) return metadataPromise;
    metadataPromise = (async () => {
      const res = await fetcher(`${authority.replace(/\/$/, "")}/.well-known/openid-configuration`);
      if (!res.ok) {
        throw new Error(`[elur-auth] OIDC metadata discovery failed: ${res.status}`);
      }
      return (await res.json()) as Record<string, unknown>;
    })();
    try {
      return await metadataPromise;
    } catch (err) {
      metadataPromise = null;
      throw err;
    }
  }

  async function buildLoginUrl(): Promise<OidcLoginUrl> {
    const meta = await resolveMetadata();
    const authorizationEndpoint = meta["authorization_endpoint"];
    if (typeof authorizationEndpoint !== "string") {
      throw new Error("[elur-auth] OIDC authorization_endpoint not found in metadata.");
    }
    const state = generateRandomString(32);
    const nonce = generateRandomString(32);
    const codeVerifier = generateRandomString(64);
    const codeChallenge = await generateCodeChallenge(codeVerifier);

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: responseType,
      scope,
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });

    return {
      url: `${authorizationEndpoint}?${params.toString()}`,
      state,
      codeVerifier,
      nonce,
    };
  }

  async function buildLogoutUrl(idToken?: string): Promise<string> {
    const meta = await resolveMetadata();
    const endSessionEndpoint = meta["end_session_endpoint"];
    if (typeof endSessionEndpoint !== "string") {
      throw new Error("[elur-auth] OIDC end_session_endpoint not found in metadata.");
    }
    const params = new URLSearchParams();
    if (idToken) params.set("id_token_hint", idToken);
    if (postLogoutRedirectUri) params.set("post_logout_redirect_uri", postLogoutRedirectUri);
    return params.toString() ? `${endSessionEndpoint}?${params.toString()}` : endSessionEndpoint;
  }

  async function login(credentials: OidcCredentials): Promise<OidcSession<User>> {
    const meta = await resolveMetadata();
    const tokenEndpoint = meta["token_endpoint"];
    if (typeof tokenEndpoint !== "string") {
      throw new Error("[elur-auth] OIDC token_endpoint not found in metadata.");
    }

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code: credentials.code,
      redirect_uri: redirectUri,
      code_verifier: credentials.codeVerifier,
    });

    const res = await fetcher(tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!res.ok) {
      throw new Error(`[elur-auth] OIDC token exchange failed: ${res.status}`);
    }

    const tokenResponse = (await res.json()) as Record<string, unknown>;
    const accessToken = tokenResponse.access_token as string;
    const idToken = tokenResponse.id_token as string;
    const refreshToken = tokenResponse.refresh_token as string | undefined;
    const expiresIn = tokenResponse.expires_in as number | undefined;
    const claims = parseJwt(idToken);

    const userinfoEndpoint = meta["userinfo_endpoint"];
    let user = claims as unknown as User;
    if (typeof userinfoEndpoint === "string") {
      const userRes = await fetcher(userinfoEndpoint, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (userRes.ok) {
        user = (await userRes.json()) as User;
      }
    }

    return {
      user,
      idToken,
      accessToken,
      refreshToken,
      expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : undefined,
      claims,
    };
  }

  async function logout(_session: OidcSession<User>): Promise<void> {
    // Server-side logout is typically handled by redirecting to end_session_endpoint.
    // Use performLogout() for automatic redirect/fetch.
  }

  async function performLogout(
    session: OidcSession<User>,
    options: {
      mode?: "redirect" | "fetch";
      redirect?: (url: string) => void;
    } = {},
  ): Promise<void> {
    const { mode = "redirect", redirect } = options;
    const url = await buildLogoutUrl(session.idToken);

    if (mode === "fetch") {
      // Background fetch logout (if the provider supports it via back-channel).
      try {
        await fetcher(url, { method: "GET", credentials: "include" });
      } catch {
        // Ignore network errors during back-channel logout.
      }
      return;
    }

    // Redirect mode — navigate the browser to the end_session endpoint.
    if (redirect) {
      redirect(url);
    } else if (typeof globalThis !== "undefined" && "location" in globalThis) {
      globalThis.location.href = url;
    } else {
      throw new Error(
        "[elur-auth] OIDC performLogout: no redirect function provided and window.location is unavailable.",
      );
    }
  }

  return {
    name: "oidc",
    login,
    logout,
    resolveMetadata,
    buildLoginUrl,
    buildLogoutUrl,
    performLogout,
    toUser: (session) => session.user,
    getToken: (session) => session.accessToken,
    getExpiry: (session) => session.expiresAt,
  };
}
