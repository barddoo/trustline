import { createPrivateKey } from "node:crypto";

import { type JSONWebKeySet, SignJWT } from "jose";
import { v7 } from "uuid";

import { generateSecret, hashSecret, verifySecret } from "../core/crypto";
import {
  createSigningKey,
  exportSigningKeyToJwk,
  getSigningKeyForIssuance,
  getVerificationSigningKeys,
  type SigningAlgorithm,
} from "../core/keys";
import { parseScopes } from "../core/scopes";
import type {
  RevokedToken,
  ServiceClient,
  SigningKey,
  StorageAdapter,
} from "../storage/interface";

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

export interface RotateSigningKeyInput {
  activateAt?: Date;
  algorithm?: SigningAlgorithm;
  keyId?: string;
  overlapSeconds?: number;
  privateKey?: string;
}

export interface Provider {
  handle(request: Request): Promise<Response>;
  clients: {
    create(input: CreateProviderClientInput): Promise<CreatedProviderClient>;
    list(): Promise<ServiceClient[]>;
    revoke(clientId: string): Promise<void>;
    disable(clientId: string): Promise<void>;
    enable(clientId: string): Promise<void>;
    invalidateTokensBefore(clientId: string, at?: Date): Promise<void>;
  };
  keys: {
    rotate(input?: RotateSigningKeyInput): Promise<{ keyId: string }>;
  };
  tokens: {
    revoke(jti: string, expiresAt: Date): Promise<void>;
  };
}

const DEFAULT_TOKEN_TTL_SECONDS = 300;
const JWKS_CACHE_CONTROL_HEADER = "public, max-age=600";

export function createProvider(options: ProviderOptions): Provider {
  const provider = new TrustlineProvider(options);

  return {
    handle(request) {
      return provider.handle(request);
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
      disable(clientId) {
        return provider.setClientActive(clientId, false);
      },
      enable(clientId) {
        return provider.setClientActive(clientId, true);
      },
      invalidateTokensBefore(clientId, at) {
        return provider.invalidateTokensBefore(clientId, at);
      },
    },
    keys: {
      rotate(input) {
        return provider.rotateSigningKey(input);
      },
    },
    tokens: {
      revoke(jti, expiresAt) {
        return provider.revokeToken({
          jti,
          expiresAt,
        });
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
      active: true,
      tokensInvalidBefore: null,
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

  setClientActive(clientId: string, active: boolean): Promise<void> {
    return this.options.storage.setClientActive(clientId, active);
  }

  invalidateTokensBefore(clientId: string, at = new Date()): Promise<void> {
    return this.options.storage.setTokensInvalidBefore(clientId, at);
  }

  revokeToken(token: RevokedToken): Promise<void> {
    return this.options.storage.revokeToken(token);
  }

  private async handleJwks(): Promise<Response> {
    const jwks = await this.getJwks();
    return jsonResponse(jwks, 200, {
      "cache-control": JWKS_CACHE_CONTROL_HEADER,
    });
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

    if (!client.active) {
      return jsonResponse(
        {
          error: "invalid_client",
          error_description: "Client is inactive",
        },
        401,
      );
    }

    const grantedScopes = resolveGrantedScopes(body.get("scope"), client.scopes);
    if (!grantedScopes) {
      return jsonResponse(
        {
          error: "invalid_scope",
          error_description: "Requested scope exceeds client permissions",
        },
        400,
      );
    }

    const token = await this.issueAccessToken({
      audience: body.get("audience") ?? undefined,
      client,
      scopes: grantedScopes,
    });

    await this.options.storage.touchClient(client.clientId, new Date());

    return jsonResponse({
      access_token: token,
      token_type: "Bearer",
      expires_in: this.options.token?.ttl ?? DEFAULT_TOKEN_TTL_SECONDS,
      scope: grantedScopes.join(" "),
    });
  }

  private async issueAccessToken(input: {
    audience?: string;
    client: ServiceClient;
    scopes: string[];
  }): Promise<string> {
    const signingKey = await this.ensureSigningKeyForIssuance();
    const privateKey = createPrivateKey(signingKey.privateKey);
    const ttl = this.options.token?.ttl ?? DEFAULT_TOKEN_TTL_SECONDS;

    const jwt = new SignJWT({
      name: input.client.name,
      scope: input.scopes.join(" "),
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
    const keys = getVerificationSigningKeys(await this.options.storage.getSigningKeys());
    if (keys.length === 0) {
      await this.ensureSigningKeyForIssuance();
      return this.getJwks();
    }

    return {
      keys: await Promise.all(keys.map((key) => exportSigningKeyToJwk(key))),
    };
  }

  private async ensureSigningKeyForIssuance(): Promise<SigningKey> {
    const current = getSigningKeyForIssuance(await this.options.storage.getSigningKeys());
    if (current) {
      return current;
    }

    const key = await createSigningKey(this.options.signing);
    await this.options.storage.addSigningKey(key);
    return key;
  }

  async rotateSigningKey(
    input: RotateSigningKeyInput = {},
  ): Promise<{ keyId: string }> {
    const now = new Date();
    const activateAt = input.activateAt ?? now;
    const current = await this.ensureSigningKeyForIssuance();
    const next = await createSigningKey({
      algorithm: input.algorithm ?? this.options.signing?.algorithm,
      keyId: input.keyId,
      privateKey: input.privateKey,
    });

    next.notBefore = activateAt;
    await this.options.storage.addSigningKey(next);

    const overlapSeconds =
      input.overlapSeconds ??
      (this.options.token?.ttl ?? DEFAULT_TOKEN_TTL_SECONDS) + 60;
    const currentNotAfter = new Date(
      activateAt.getTime() + overlapSeconds * 1000,
    );

    await this.options.storage.setSigningKeyNotAfter(
      current.keyId,
      currentNotAfter,
    );

    return { keyId: next.keyId };
  }
}

function jsonResponse(
  body: unknown,
  status = 200,
  headers?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      ...headers,
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

function resolveGrantedScopes(
  requestedScope: string | null,
  allowedScopes: string[],
): string[] | null {
  if (!requestedScope) {
    return [...allowedScopes];
  }

  const requestedScopes = parseScopes(requestedScope);
  const allowedScopeSet = new Set(allowedScopes);

  for (const scope of requestedScopes) {
    if (!allowedScopeSet.has(scope)) {
      return null;
    }
  }

  return requestedScopes;
}
