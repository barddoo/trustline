import type { GuardOptions, ServiceIdentity } from "../core/token";
import { verifyToken } from "../core/token";

export type { GuardOptions, ServiceIdentity } from "../core/token";

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
