import {
  type GuardOptions,
  type ServiceIdentity,
  verifyToken,
} from "../core/token";

export type {
  GuardEvent,
  GuardHooks,
  GuardOptions,
  ServiceIdentity,
} from "../core/token";

export interface Guard {
  verify(token: string): Promise<ServiceIdentity>;
}

export function createGuard(options: GuardOptions): Guard {
  return {
    verify(token: string) {
      return verifyToken(token, options);
    },
  };
}
