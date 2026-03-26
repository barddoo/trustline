import type { RequestHandler } from "express";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { MiddlewareHandler } from "hono";
import type { GuardOptions, ServiceIdentity } from "../core/token";
import { createGuard as createCoreGuard } from "../guard/index";
import { createExpressGuard } from "./express";
import { createFastifyGuard } from "./fastify";
import { createHonoGuard } from "./hono";

export type { GuardOptions, ServiceIdentity } from "../core/token";
export type { TrustlineRequest } from "./express";
export type { TrustlineFastifyRequest } from "./fastify";

export interface Guard {
  verify(token: string): Promise<ServiceIdentity>;
  express(): RequestHandler;
  fastify(): (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  hono(): MiddlewareHandler;
}

export function createGuard(options: GuardOptions): Guard {
  const guard = createCoreGuard(options);

  return {
    verify(token: string) {
      return guard.verify(token);
    },
    express() {
      return createExpressGuard(guard);
    },
    fastify() {
      return createFastifyGuard(options);
    },
    hono() {
      return createHonoGuard(options);
    },
  };
}
