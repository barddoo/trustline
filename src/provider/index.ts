import { createPrivateKey } from "node:crypto";

import type { FastifyPluginAsync } from "fastify";
import { Hono } from "hono";
import { type JSONWebKeySet, SignJWT } from "jose";
import { v7 } from "uuid";

import { generateSecret, hashSecret, verifySecret } from "../core/crypto";
import {
  createSigningKey,
  exportSigningKeyToJwk,
  getActiveSigningKeys,
  type SigningAlgorithm,
} from "../core/keys";
import { parseScopes } from "../core/scopes";
import type {
  ServiceClient,
  SigningKey,
  StorageAdapter,
} from "../storage/interface";
import { createExpressProvider } from "./express";

export interface ProviderOptions {
  issuer: string;
  storage: StorageAdapter;
  signing?: {
    algorithm?: SigningAlgorithm;
    privateKey?: string;
    keyId?: string;
  };
  token?: {
    ttl?: number;
  };
  env?: string;
}

export interface CreateProviderClientInput {
  name: string;
  scopes?: string[];
}

export interface CreatedProviderClient {
  clientId: string;
  clientSecret: string;
}

export interface Provider {
  handle(request: Request): Promise<Response>;
  express(): import("express").RequestHandler;
  fastify(): FastifyPluginAsync;
  hono(): Hono;
  clients: {
    create(input: CreateProviderClientInput): Promise<CreatedProviderClient>;
    list(): Promise<ServiceClient[]>;
    revoke(clientId: string): Promise<void>;
  };
}

const DEFAULT_TOKEN_TTL_SECONDS = 300;

export function createProvider(options: ProviderOptions): Provider {
  const provider = new TrustlineProvider(options);

  return {
    handle(request) {
      return provider.handle(request);
    },
    express() {
      return createExpressProvider(provider);
    },
    fastify() {
      return async (fastify) => {
        fastify.get("/.well-known/jwks.json", async (_request, reply) => {
          const response = await provider.handle(
            new Request(buildBaseUrl(options.issuer, "/.well-known/jwks.json")),
          );
          await writeFastifyResponse(reply, response);
        });

        fastify.post("/token", async (request, reply) => {
          const response = await provider.handle(
            new Request(buildBaseUrl(options.issuer, "/token"), {
              method: "POST",
              headers: createHeaders(request.headers),
              body: serializeRequestBody(request.body),
            }),
          );
          await writeFastifyResponse(reply, response);
        });
      };
    },
    hono() {
      const app = new Hono();
      app.get("/.well-known/jwks.json", async () =>
        provider.handle(
          new Request(buildBaseUrl(options.issuer, "/.well-known/jwks.json")),
        ),
      );
      app.post("/token", async (context) => {
        const response = await provider.handle(
          new Request(buildBaseUrl(options.issuer, "/token"), {
            method: "POST",
            headers: context.req.raw.headers,
            body: context.req.raw.body,
          }),
        );
        return response;
      });
      return app;
    },
    clients: {
      create(input) {
        return provider.createClient(input);
      },
      list() {
        return provider.listClients();
      },
      revoke(clientId) {
        return provider.revokeClient(clientId);
      },
    },
  };
}

class TrustlineProvider {
  constructor(private readonly options: ProviderOptions) {}

  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (
      request.method === "GET" &&
      url.pathname.endsWith("/.well-known/jwks.json")
    ) {
      return this.handleJwks();
    }

    if (request.method === "POST" && url.pathname.endsWith("/token")) {
      return this.handleToken(request);
    }

    return jsonResponse({ error: "not_found", message: "Not found" }, 404);
  }

  async createClient(
    input: CreateProviderClientInput,
  ): Promise<CreatedProviderClient> {
    const clientSecret = generateSecret();
    const client: ServiceClient = {
      id: v7(),
      clientId: `svc_${v7().replaceAll("-", "")}`,
      clientSecret: await hashSecret(clientSecret),
      name: input.name,
      scopes: parseScopes(input.scopes?.join(" ")),
      createdAt: new Date(),
      lastSeenAt: null,
    };

    await this.options.storage.createClient(client);

    return {
      clientId: client.clientId,
      clientSecret,
    };
  }

  listClients(): Promise<ServiceClient[]> {
    return this.options.storage.listClients();
  }

  revokeClient(clientId: string): Promise<void> {
    return this.options.storage.deleteClient(clientId);
  }

  private async handleJwks(): Promise<Response> {
    const jwks = await this.getJwks();
    return jsonResponse(jwks);
  }

  private async handleToken(request: Request): Promise<Response> {
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.includes("application/x-www-form-urlencoded")) {
      return jsonResponse(
        {
          error: "invalid_request",
          error_description: "Expected application/x-www-form-urlencoded body",
        },
        400,
      );
    }

    const body = new URLSearchParams(await request.text());
    const grantType = body.get("grant_type");

    if (grantType !== "client_credentials") {
      return jsonResponse(
        {
          error: "unsupported_grant_type",
          error_description: "Only client_credentials is supported",
        },
        400,
      );
    }

    const credentials = getBasicCredentials(
      request.headers.get("authorization"),
    ) ?? {
      clientId: body.get("client_id"),
      clientSecret: body.get("client_secret"),
    };

    if (!credentials.clientId || !credentials.clientSecret) {
      return jsonResponse(
        {
          error: "invalid_client",
          error_description: "Missing client credentials",
        },
        401,
      );
    }

    const client = await this.options.storage.findClient(credentials.clientId);
    if (
      !client ||
      !(await verifySecret(credentials.clientSecret, client.clientSecret))
    ) {
      return jsonResponse(
        {
          error: "invalid_client",
          error_description: "Client authentication failed",
        },
        401,
      );
    }

    const token = await this.issueAccessToken({
      audience: body.get("audience") ?? undefined,
      client,
    });

    await this.options.storage.touchClient(client.clientId, new Date());

    return jsonResponse({
      access_token: token,
      token_type: "Bearer",
      expires_in: this.options.token?.ttl ?? DEFAULT_TOKEN_TTL_SECONDS,
      scope: client.scopes.join(" "),
    });
  }

  private async issueAccessToken(input: {
    audience?: string;
    client: ServiceClient;
  }): Promise<string> {
    const signingKey = await this.ensureActiveSigningKey();
    const privateKey = createPrivateKey(signingKey.privateKey);
    const ttl = this.options.token?.ttl ?? DEFAULT_TOKEN_TTL_SECONDS;

    const jwt = new SignJWT({
      name: input.client.name,
      scope: input.client.scopes.join(" "),
      ...(this.options.env ? { env: this.options.env } : {}),
    })
      .setProtectedHeader({
        alg: signingKey.algorithm,
        kid: signingKey.keyId,
      })
      .setIssuer(this.options.issuer)
      .setSubject(input.client.clientId)
      .setJti(v7())
      .setIssuedAt()
      .setExpirationTime(`${ttl}s`);

    if (input.audience) {
      jwt.setAudience(input.audience);
    }

    return jwt.sign(privateKey);
  }

  private async getJwks(): Promise<JSONWebKeySet> {
    const keys = getActiveSigningKeys(
      await this.options.storage.getSigningKeys(),
    );
    if (keys.length === 0) {
      await this.ensureActiveSigningKey();
      return this.getJwks();
    }

    return {
      keys: await Promise.all(keys.map((key) => exportSigningKeyToJwk(key))),
    };
  }

  private async ensureActiveSigningKey(): Promise<SigningKey> {
    const existing = getActiveSigningKeys(
      await this.options.storage.getSigningKeys(),
    );
    const current = existing[0];
    if (current) {
      return current;
    }

    const key = await createSigningKey(this.options.signing);
    await this.options.storage.addSigningKey(key);
    return key;
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

function getBasicCredentials(header: string | null): {
  clientId: string | null;
  clientSecret: string | null;
} | null {
  if (!header) {
    return null;
  }

  const [scheme, value] = header.split(/\s+/, 2);
  if (scheme?.toLowerCase() !== "basic" || !value) {
    return null;
  }

  const decoded = Buffer.from(value, "base64").toString("utf8");
  const separatorIndex = decoded.indexOf(":");

  if (separatorIndex === -1) {
    return null;
  }

  return {
    clientId: decoded.slice(0, separatorIndex),
    clientSecret: decoded.slice(separatorIndex + 1),
  };
}

function buildBaseUrl(issuer: string, pathname: string): string {
  const base = issuer.endsWith("/") ? issuer.slice(0, -1) : issuer;
  return `${base}${pathname}`;
}

function createHeaders(headers: Record<string, unknown>): Headers {
  const normalized = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") {
      normalized.set(key, value);
    }

    if (Array.isArray(value)) {
      normalized.set(key, value.join(", "));
    }
  }
  return normalized;
}

function serializeRequestBody(body: unknown): string | undefined {
  if (typeof body === "string") {
    return body;
  }

  if (!body || typeof body !== "object") {
    return undefined;
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined || value === null) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        params.append(key, String(item));
      }
      continue;
    }

    params.set(key, String(value));
  }

  return params.toString();
}

async function writeFastifyResponse(
  reply: {
    code(status: number): void;
    header(name: string, value: string): void;
    send(payload: string): void;
  },
  response: Response,
): Promise<void> {
  reply.code(response.status);
  response.headers.forEach((value, key) => {
    reply.header(key, value);
  });
  reply.send(await response.text());
}
