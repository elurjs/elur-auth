import { createCommand } from "@elurjs/query";
import type {
  CommandOptions,
  CommandResult,
  CommandContext,
} from "@elurjs/query";
import type { AuthInstance } from "./core/types";

export type AuthCommandContext = CommandContext & {
  token: string | null;
};

export function authCommand<TVariables = unknown, TResult = unknown>(
  auth: AuthInstance,
  commandKey: string,
  executeFn: (variables: TVariables, context: AuthCommandContext) => Promise<TResult>,
  options: CommandOptions<TVariables, TResult> = {},
): CommandResult<TVariables, TResult> {
  return createCommand<TVariables, TResult>(
    commandKey,
    (variables, context) =>
      executeFn(variables, {
        ...context,
        token: auth.token.value,
      }),
    options,
  );
}

export function createLoginCommand<Credentials = unknown, TResult = unknown>(
  auth: AuthInstance<unknown, TResult, Credentials>,
  commandKey: string,
  options: CommandOptions<Credentials, TResult> = {},
): CommandResult<Credentials, TResult> {
  return createCommand<Credentials, TResult>(
    commandKey,
    async (credentials) => {
      await auth.login(credentials);
      return auth.user.value as TResult;
    },
    options,
  );
}

export function createLogoutCommand(
  auth: AuthInstance,
  commandKey: string,
  options: CommandOptions<void, void> = {},
): CommandResult<void, void> {
  return createCommand<void, void>(
    commandKey,
    async () => {
      await auth.logout();
    },
    options,
  );
}

export function authHeaders(auth: AuthInstance): Record<string, string> {
  const token = auth.token.value;
  return token ? { Authorization: `Bearer ${token}` } : {};
}
