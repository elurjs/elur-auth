import type { NavigationGuardResult } from "@elurjs/core/router";
import type { AuthInstance } from "../core/types";

export type RouteAuthMeta =
  | false
  | "public"
  | "optional"
  | string
  | string[]
  | RouteAuthMetaObject
  | RouteAuthMetaFunction;

export interface RouteAuthMetaObject {
  provider?: string;
  can?: string;
  context?: unknown | (() => unknown);
  role?: string;
  roles?: string[];
  permission?: string;
  permissions?: string[];
  redirect?: string;
  allow?: boolean | RouteAuthMetaFunction;
}

export type RouteAuthMetaFunction = (
  to: string,
  from: string,
  auth: AuthInstance,
) => NavigationGuardResult | Promise<NavigationGuardResult>;

export type MetaInterpreter = (
  meta: RouteAuthMeta | undefined,
  auth: AuthInstance,
  to: string,
  from: string,
) => NavigationGuardResult | Promise<NavigationGuardResult>;

export function isPublic(meta: RouteAuthMeta | undefined): boolean {
  return meta === false || meta === "public";
}
