import type { RequestHandler } from "express";

import {
  type GuardOptions,
  type ServiceIdentity,
  verifyToken,
} from "../core/token";
import { createExpressGuard } from "./express";

export type { GuardOptions, ServiceIdentity } from "../core/token";
export type { TrustlineRequest } from "./express";

export interface Guard {
  verify(token: string): Promise<ServiceIdentity>;
  express(): RequestHandler;
}

export function createGuard(options: GuardOptions): Guard {
  return {
    verify(token: string) {
      return verifyToken(token, options);
    },
    express() {
      return createExpressGuard(options);
    },
  };
}
