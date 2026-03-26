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

export interface ProviderClient {
  id: string;
  clientId: string;
  name: string;
  scopes: string[];
  createdAt: Date;
  updatedAt: Date;
  lastSeenAt: Date | null;
  currentSecretCreatedAt: Date;
  currentSecretLastUsedAt: Date | null;
  nextSecretCreatedAt: Date | null;
  nextSecretExpiresAt: Date | null;
  nextSecretLastUsedAt: Date | null;
  secretLastRotatedAt: Date | null;
  active: boolean;
  tokensInvalidBefore: Date | null;
  hasPendingSecretRotation: boolean;
}

export interface ProviderEventBase {
  type:
    | "client.created"
    | "client.renamed"
    | "client.scopes_updated"
    | "client.activated"
    | "client.deactivated"
    | "client.secret_rotated"
    | "token.issued"
    | "token.issuance_failed";
  timestamp: Date;
  issuer: string;
  outcome: "success" | "failure";
  clientId?: string;
  audience?: string;
  reasonCode?: string;
}

export interface ProviderEvent extends ProviderEventBase {
  metadata?: Record<string, unknown>;
}

export interface ProviderHooks {
  onEvent?(event: ProviderEvent): void | Promise<void>;
}

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
  hooks?: ProviderHooks;
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

export interface RotateClientSecretInput {
  expiresAt?: Date;
  overlapSeconds?: number;
}

export interface RotatedProviderClientSecret {
  clientId: string;
  clientSecret: string;
  expiresAt: Date | null;
}

export interface Provider {
  handle(request: Request): Promise<Response>;
  clients: {
    create(input: CreateProviderClientInput): Promise<CreatedProviderClient>;
    list(): Promise<ProviderClient[]>;
    get(clientId: string): Promise<ProviderClient | null>;
    rename(clientId: string, name: string): Promise<void>;
    updateScopes(clientId: string, scopes: string[]): Promise<void>;
    rotateSecret(
      clientId: string,
      input?: RotateClientSecretInput,
    ): Promise<RotatedProviderClientSecret>;
    revoke(clientId: string): Promise<void>;
    disable(clientId: string): Promise<void>;
    enable(clientId: string): Promise<void>;
    invalidateTokensBefore(clientId: string, at?: Date): Promise<void>;
    clearTokensInvalidBefore(clientId: string): Promise<void>;
  };
  keys: {
    rotate(input?: RotateSigningKeyInput): Promise<{ keyId: string }>;
  };
  tokens: {
    revoke(jti: string, expiresAt: Date): Promise<void>;
  };
}

const DEFAULT_TOKEN_TTL_SECONDS = 300;
const DEFAULT_SECRET_ROTATION_OVERLAP_SECONDS = 3600;
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
      get(clientId) {
        return provider.getClient(clientId);
      },
      rename(clientId, name) {
        return provider.renameClient(clientId, name);
      },
      updateScopes(clientId, scopes) {
        return provider.updateClientScopes(clientId, scopes);
      },
      rotateSecret(clientId, input) {
        return provider.rotateClientSecret(clientId, input);
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
      clearTokensInvalidBefore(clientId) {
        return provider.clearTokensInvalidBefore(clientId);
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
    const now = new Date();
    const client: ServiceClient = {
      id: v7(),
      clientId: `svc_${v7().replaceAll("-", "")}`,
      name: input.name,
      scopes: parseScopes(input.scopes?.join(" ")),
      createdAt: now,
      updatedAt: now,
      lastSeenAt: null,
      currentSecretHash: await hashSecret(clientSecret),
      currentSecretCreatedAt: now,
      currentSecretLastUsedAt: null,
      nextSecretHash: null,
      nextSecretCreatedAt: null,
      nextSecretExpiresAt: null,
      nextSecretLastUsedAt: null,
      secretLastRotatedAt: null,
      active: true,
      tokensInvalidBefore: null,
    };

    await this.options.storage.createClient(client);
    await this.emitEvent({
      type: "client.created",
      timestamp: now,
      issuer: this.options.issuer,
      outcome: "success",
      clientId: client.clientId,
      metadata: {
        scopeCount: client.scopes.length,
      },
    });

    return {
      clientId: client.clientId,
      clientSecret,
    };
  }

  async listClients(): Promise<ProviderClient[]> {
    const clients = await this.options.storage.listClients();
    const normalized = await Promise.all(
      clients.map((client) => this.normalizeClient(client)),
    );
    return normalized.map((client) => toProviderClient(client));
  }

  async getClient(clientId: string): Promise<ProviderClient | null> {
    const client = await this.options.storage.findClient(clientId);
    if (!client) {
      return null;
    }

    return toProviderClient(await this.normalizeClient(client));
  }

  async renameClient(clientId: string, name: string): Promise<void> {
    const client = await this.requireClient(clientId);
    const now = new Date();

    await this.options.storage.updateClient(clientId, {
      name,
      updatedAt: now,
    });

    await this.emitEvent({
      type: "client.renamed",
      timestamp: now,
      issuer: this.options.issuer,
      outcome: "success",
      clientId,
      metadata: {
        previousName: client.name,
        name,
      },
    });
  }

  async updateClientScopes(clientId: string, scopes: string[]): Promise<void> {
    await this.requireClient(clientId);
    const normalizedScopes = parseScopes(scopes.join(" "));
    const now = new Date();

    await this.options.storage.updateClient(clientId, {
      scopes: normalizedScopes,
      updatedAt: now,
    });

    await this.emitEvent({
      type: "client.scopes_updated",
      timestamp: now,
      issuer: this.options.issuer,
      outcome: "success",
      clientId,
      metadata: {
        scopes: normalizedScopes,
      },
    });
  }

  async rotateClientSecret(
    clientId: string,
    input: RotateClientSecretInput = {},
  ): Promise<RotatedProviderClientSecret> {
    const client = await this.requireClient(clientId);
    const normalized = await this.normalizeClient(client);
    const now = new Date();
    const secret = generateSecret();
    const secretHash = await hashSecret(secret);
    const expiresAt =
      input.expiresAt ??
      (input.overlapSeconds === 0
        ? null
        : new Date(
            now.getTime() +
              (input.overlapSeconds ??
                DEFAULT_SECRET_ROTATION_OVERLAP_SECONDS) *
                1000,
          ));

    if (expiresAt && expiresAt.getTime() <= now.getTime()) {
      throw new Error("Secret rotation expiry must be in the future");
    }

    if (expiresAt === null) {
      await this.options.storage.updateClient(clientId, {
        currentSecretHash: secretHash,
        currentSecretCreatedAt: now,
        currentSecretLastUsedAt: null,
        nextSecretHash: null,
        nextSecretCreatedAt: null,
        nextSecretExpiresAt: null,
        nextSecretLastUsedAt: null,
        secretLastRotatedAt: now,
        updatedAt: now,
      });
    } else {
      await this.options.storage.updateClient(clientId, {
        currentSecretHash: normalized.currentSecretHash,
        nextSecretHash: secretHash,
        nextSecretCreatedAt: now,
        nextSecretExpiresAt: expiresAt,
        nextSecretLastUsedAt: null,
        secretLastRotatedAt: now,
        updatedAt: now,
      });
    }

    await this.emitEvent({
      type: "client.secret_rotated",
      timestamp: now,
      issuer: this.options.issuer,
      outcome: "success",
      clientId,
      metadata: {
        expiresAt: expiresAt?.toISOString() ?? null,
      },
    });

    return {
      clientId,
      clientSecret: secret,
      expiresAt,
    };
  }

  revokeClient(clientId: string): Promise<void> {
    return this.options.storage.deleteClient(clientId);
  }

  async setClientActive(clientId: string, active: boolean): Promise<void> {
    await this.requireClient(clientId);
    const now = new Date();
    await this.options.storage.updateClient(clientId, {
      active,
      updatedAt: now,
    });

    await this.emitEvent({
      type: active ? "client.activated" : "client.deactivated",
      timestamp: now,
      issuer: this.options.issuer,
      outcome: "success",
      clientId,
    });
  }

  async invalidateTokensBefore(
    clientId: string,
    at = new Date(),
  ): Promise<void> {
    await this.requireClient(clientId);
    await this.options.storage.updateClient(clientId, {
      tokensInvalidBefore: at,
      updatedAt: new Date(),
    });
  }

  async clearTokensInvalidBefore(clientId: string): Promise<void> {
    await this.requireClient(clientId);
    await this.options.storage.updateClient(clientId, {
      tokensInvalidBefore: null,
      updatedAt: new Date(),
    });
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
      return this.tokenError(
        "invalid_request",
        "Expected application/x-www-form-urlencoded body",
        400,
      );
    }

    const body = new URLSearchParams(await request.text());
    const grantType = body.get("grant_type");

    if (grantType !== "client_credentials") {
      return this.tokenError(
        "unsupported_grant_type",
        "Only client_credentials is supported",
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
      return this.tokenError(
        "invalid_client",
        "Missing client credentials",
        401,
      );
    }

    const client = await this.options.storage.findClient(credentials.clientId);
    if (!client) {
      return this.tokenError(
        "invalid_client",
        "Client authentication failed",
        401,
        {
          clientId: credentials.clientId ?? undefined,
        },
      );
    }

    const normalizedClient = await this.normalizeClient(client);
    const matchedSecret = await this.verifyClientSecret(
      normalizedClient,
      credentials.clientSecret,
    );
    if (!matchedSecret) {
      return this.tokenError(
        "invalid_client",
        "Client authentication failed",
        401,
        {
          clientId: normalizedClient.clientId,
        },
      );
    }

    if (!normalizedClient.active) {
      return this.tokenError("invalid_client", "Client is inactive", 401, {
        clientId: normalizedClient.clientId,
      });
    }

    const grantedScopes = resolveGrantedScopes(
      body.get("scope"),
      normalizedClient.scopes,
    );
    if (!grantedScopes) {
      return this.tokenError(
        "invalid_scope",
        "Requested scope exceeds client permissions",
        400,
        {
          clientId: normalizedClient.clientId,
          metadata: {
            requestedScopes: parseScopes(body.get("scope") ?? ""),
          },
        },
      );
    }

    const now = new Date();
    await this.recordClientUsage(normalizedClient, matchedSecret, now);

    const token = await this.issueAccessToken({
      audience: body.get("audience") ?? undefined,
      client: normalizedClient,
      scopes: grantedScopes,
    });

    await this.emitEvent({
      type: "token.issued",
      timestamp: now,
      issuer: this.options.issuer,
      outcome: "success",
      clientId: normalizedClient.clientId,
      audience: body.get("audience") ?? undefined,
      metadata: {
        grantedScopes,
      },
    });

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
    const keys = getVerificationSigningKeys(
      await this.options.storage.getSigningKeys(),
    );
    if (keys.length === 0) {
      await this.ensureSigningKeyForIssuance();
      return this.getJwks();
    }

    return {
      keys: await Promise.all(keys.map((key) => exportSigningKeyToJwk(key))),
    };
  }

  private async ensureSigningKeyForIssuance(): Promise<SigningKey> {
    const current = getSigningKeyForIssuance(
      await this.options.storage.getSigningKeys(),
    );
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

  private async normalizeClient(client: ServiceClient): Promise<ServiceClient> {
    if (
      !client.nextSecretHash ||
      !client.nextSecretExpiresAt ||
      client.nextSecretExpiresAt.getTime() > Date.now()
    ) {
      return client;
    }

    const promoted: ServiceClient = {
      ...client,
      currentSecretHash: client.nextSecretHash,
      currentSecretCreatedAt: client.nextSecretCreatedAt ?? new Date(),
      currentSecretLastUsedAt: client.nextSecretLastUsedAt,
      nextSecretHash: null,
      nextSecretCreatedAt: null,
      nextSecretExpiresAt: null,
      nextSecretLastUsedAt: null,
      updatedAt: new Date(),
    };

    await this.options.storage.updateClient(client.clientId, {
      currentSecretHash: promoted.currentSecretHash,
      currentSecretCreatedAt: promoted.currentSecretCreatedAt,
      currentSecretLastUsedAt: promoted.currentSecretLastUsedAt,
      nextSecretHash: null,
      nextSecretCreatedAt: null,
      nextSecretExpiresAt: null,
      nextSecretLastUsedAt: null,
      updatedAt: promoted.updatedAt,
    });

    return promoted;
  }

  private async verifyClientSecret(
    client: ServiceClient,
    providedSecret: string,
  ): Promise<"current" | "next" | null> {
    if (await verifySecret(providedSecret, client.currentSecretHash)) {
      return "current";
    }

    if (
      client.nextSecretHash &&
      client.nextSecretExpiresAt &&
      client.nextSecretExpiresAt.getTime() > Date.now() &&
      (await verifySecret(providedSecret, client.nextSecretHash))
    ) {
      return "next";
    }

    return null;
  }

  private async recordClientUsage(
    client: ServiceClient,
    secretKind: "current" | "next",
    at: Date,
  ): Promise<void> {
    await this.options.storage.updateClient(client.clientId, {
      lastSeenAt: at,
      updatedAt: at,
      ...(secretKind === "current"
        ? { currentSecretLastUsedAt: at }
        : { nextSecretLastUsedAt: at }),
    });
  }

  private async requireClient(clientId: string): Promise<ServiceClient> {
    const client = await this.options.storage.findClient(clientId);
    if (!client) {
      throw new Error(`Unknown client: ${clientId}`);
    }

    return this.normalizeClient(client);
  }

  private async tokenError(
    code: string,
    description: string,
    status: number,
    event?: Omit<ProviderEvent, "type" | "timestamp" | "issuer" | "outcome">,
  ): Promise<Response> {
    await this.emitEvent({
      type: "token.issuance_failed",
      timestamp: new Date(),
      issuer: this.options.issuer,
      outcome: "failure",
      reasonCode: code,
      ...event,
    });

    return jsonResponse(
      {
        error: code,
        error_description: description,
      },
      status,
    );
  }

  private async emitEvent(event: ProviderEvent): Promise<void> {
    try {
      await this.options.hooks?.onEvent?.(event);
    } catch {
      // Hooks are observational and must not break auth flows.
    }
  }
}

function toProviderClient(client: ServiceClient): ProviderClient {
  return {
    id: client.id,
    clientId: client.clientId,
    name: client.name,
    scopes: [...client.scopes],
    createdAt: new Date(client.createdAt),
    updatedAt: new Date(client.updatedAt),
    lastSeenAt: client.lastSeenAt ? new Date(client.lastSeenAt) : null,
    currentSecretCreatedAt: new Date(client.currentSecretCreatedAt),
    currentSecretLastUsedAt: client.currentSecretLastUsedAt
      ? new Date(client.currentSecretLastUsedAt)
      : null,
    nextSecretCreatedAt: client.nextSecretCreatedAt
      ? new Date(client.nextSecretCreatedAt)
      : null,
    nextSecretExpiresAt: client.nextSecretExpiresAt
      ? new Date(client.nextSecretExpiresAt)
      : null,
    nextSecretLastUsedAt: client.nextSecretLastUsedAt
      ? new Date(client.nextSecretLastUsedAt)
      : null,
    secretLastRotatedAt: client.secretLastRotatedAt
      ? new Date(client.secretLastRotatedAt)
      : null,
    active: client.active,
    tokensInvalidBefore: client.tokensInvalidBefore
      ? new Date(client.tokensInvalidBefore)
      : null,
    hasPendingSecretRotation:
      client.nextSecretHash !== null &&
      client.nextSecretExpiresAt !== null &&
      client.nextSecretExpiresAt.getTime() > Date.now(),
  };
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
  const requested = parseScopes(requestedScope ?? "");
  if (requested.length === 0) {
    return allowedScopes;
  }

  const allowed = new Set(allowedScopes);
  for (const scope of requested) {
    if (!allowed.has(scope)) {
      return null;
    }
  }

  return requested;
}
