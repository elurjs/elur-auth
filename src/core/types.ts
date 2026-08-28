import type { Signal } from "@elurjs/core";

export type AuthEvent =
  | "login"
  | "logout"
  | "refresh"
  | "hydrate"
  | "setSession"
  | "clearSession"
  | "sync";

export interface AuthDriver<Session = unknown, User = unknown, Credentials = unknown> {
  readonly name: string;

  login(credentials: Credentials): Promise<Session>;
  logout(session: Session): Promise<void>;

  hydrate?(raw: unknown): Promise<Session | null>;
  refresh?(session: Session): Promise<Session>;
  getExpiry?(session: Session): number | undefined;
  toUser?(session: Session): User;
  getToken?(session: Session): string | null;
  isValid?(session: Session): boolean;
}

export interface AuthStorage<Session> {
  get(): Session | null | Promise<Session | null>;
  set(session: Session | null): void | Promise<void>;
  remove(): void | Promise<void>;
}

export type IdentityResolver<User> = string | ((user: User) => string[]);

export interface AuthIdentity<User> {
  roles?: IdentityResolver<User>;
  permissions?: IdentityResolver<User>;
  scopes?: IdentityResolver<User>;
}

export interface AutoRefreshOptions<Session> {
  beforeExpirySeconds?: number;
  schedule?: (session: Session, refresh: () => Promise<void>) => (() => void);
}

export interface RefreshOptions {
  /**
   * Maximum number of retries for transient network errors before giving up.
   * @default 3
   */
  maxRetries?: number;
  /**
   * Delay between retries in ms, or a function receiving the failure count.
   * @default (n) => Math.min(1000 * 2 ** n, 5000)
   */
  retryDelay?: number | ((failureCount: number) => number);
  /**
   * Predicate to determine if an error is transient (network glitch, 5xx).
   * If true, the session is kept and a retry is scheduled.
   * If false, the session is invalidated (logout).
   * @default (error) => status === undefined || status >= 500 || status === 429 || error is TypeError
   */
  isTransientError?: (error: unknown) => boolean;
}

export interface MultiTabSyncOptions {
  /**
   * Channel name for BroadcastChannel. Defaults to `elur-auth:<name>`.
   */
  channelName?: string;
  /**
   * Whether multi-tab sync is enabled. @default false
   */
  enabled?: boolean;
}

export interface CreateAuthOptions<Session, User, Credentials> {
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

  /** Configuration for transient error handling during refresh. */
  refreshOptions?: RefreshOptions;
  /** Multi-tab synchronization via BroadcastChannel. */
  multiTabSync?: MultiTabSyncOptions;
}

export type PolicyDecision = boolean | { allow: boolean; redirect?: string };

export interface AuthPolicy<User, Session = unknown> {
  readonly name?: string;
  evaluate(
    user: User | null,
    action: string,
    context: unknown,
    session: Session | null,
  ): PolicyDecision;
}

export interface AuthInstance<Session = unknown, User = unknown, Credentials = unknown> {
  readonly name: string;

  readonly session: Signal<Session | null>;
  readonly user: Signal<User | null>;
  readonly token: Signal<string | null>;

  readonly isAuthenticated: Signal<boolean>;
  readonly isAnonymous: Signal<boolean>;
  readonly isReady: Signal<boolean>;
  readonly isLoading: Signal<boolean>;
  readonly error: Signal<unknown>;
  readonly activeProvider: Signal<string | null>;

  login(credentials: Credentials): Promise<void>;
  login(provider: string, credentials: Credentials): Promise<void>;
  logout(): Promise<void>;
  refresh(): Promise<void>;
  ready(options?: { force?: boolean }): Promise<void>;
  setSession(session: Session | null): void;
  clearSession(): void;

  attachPolicy(policy: AuthPolicy<User, Session>): () => void;
  detachPolicy(policy: AuthPolicy<User, Session>): void;
  can(action: string, context?: unknown): Signal<boolean>;
  authorize(action: string, context?: unknown): Signal<{ allow: boolean; redirect?: string }>;

  hasRole(role: string): Signal<boolean>;
  hasPermission(permission: string): Signal<boolean>;
  hasScope(scope: string): Signal<boolean>;
  hasAnyRole(roles: string[]): Signal<boolean>;
  hasAllPermissions(permissions: string[]): Signal<boolean>;

  checkCan(action: string, context?: unknown): boolean;
  checkAuthorize(action: string, context?: unknown): { allow: boolean; redirect?: string };
  checkRole(role: string): boolean;
  checkPermission(permission: string): boolean;
  checkScope(scope: string): boolean;
  checkAnyRole(roles: string[]): boolean;
  checkAllPermissions(permissions: string[]): boolean;

  dispose(): void;
}
