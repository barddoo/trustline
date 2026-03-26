import { errors, type JWTPayload, jwtVerify } from "jose";
import type { StorageAdapter } from "../storage/interface";
import {
  defaultJwksCache,
  type JwksCache,
  type JwksCacheResult,
} from "./cache";
import { AuthError } from "./errors";
import { hasRequiredScopes, parseScopes } from "./scopes";

const DEFAULT_CLOCK_TOLERANCE_SECONDS = 5;

export interface GuardOptions {
  issuer: string;
  jwksUrl?: string;
  audience?: string | string[];
  scopes?: string[];
  env?: string;
  clockTolerance?: number;
  jwksCache?: JwksCache;
  hooks?: GuardHooks;
  storage: StorageAdapter;
}

export interface GuardEventBase {
  type:
    | "token.verified"
    | "token.verification_failed"
    | "jwks.refreshed"
    | "jwks.refresh_failed";
  timestamp: Date;
  issuer: string;
  outcome: "success" | "failure";
  clientId?: string;
  audience?: string | string[];
  reasonCode?: string;
}

export interface GuardEvent extends GuardEventBase {
  metadata?: Record<string, unknown>;
}

export interface GuardHooks {
  onEvent?(event: GuardEvent): void | Promise<void>;
}

export interface ServiceIdentity {
  clientId: string;
  name: string | null;
  scopes: string[];
  env: string | null;
  raw: JWTPayload & Record<string, unknown>;
}

export function deriveJwksUrl(issuer: string): string {
  const normalized = issuer.endsWith("/") ? issuer.slice(0, -1) : issuer;
  return `${normalized}/.well-known/jwks.json`;
}

export async function verifyToken(
  token: string,
  options: GuardOptions,
): Promise<ServiceIdentity> {
  if (!token) {
    throw new AuthError("missing_token", "Missing bearer token", 401);
  }

  const jwksUrl = options.jwksUrl ?? deriveJwksUrl(options.issuer);
  const jwksCache = options.jwksCache ?? defaultJwksCache;

  try {
    const identity = await verifyWithCache(token, options, jwksUrl, jwksCache);
    await emitGuardEvent(options, {
      type: "token.verified",
      timestamp: new Date(),
      issuer: options.issuer,
      outcome: "success",
      clientId: identity.clientId,
      audience: options.audience,
      metadata: {
        scopes: identity.scopes,
      },
    });
    return identity;
  } catch (error) {
    if (!shouldRetryWithFreshJwks(error)) {
      const normalized = normalizeVerifyError(error);
      await emitGuardEvent(options, {
        type: "token.verification_failed",
        timestamp: new Date(),
        issuer: options.issuer,
        outcome: "failure",
        audience: options.audience,
        reasonCode: normalized.code,
      });
      throw normalized;
    }

    try {
      const identity = await verifyWithCache(
        token,
        options,
        jwksUrl,
        jwksCache,
        true,
      );
      await emitGuardEvent(options, {
        type: "token.verified",
        timestamp: new Date(),
        issuer: options.issuer,
        outcome: "success",
        clientId: identity.clientId,
        audience: options.audience,
        metadata: {
          scopes: identity.scopes,
          refreshedJwks: true,
        },
      });
      return identity;
    } catch (retryError) {
      const normalized = normalizeVerifyError(retryError);
      await emitGuardEvent(options, {
        type: "token.verification_failed",
        timestamp: new Date(),
        issuer: options.issuer,
        outcome: "failure",
        audience: options.audience,
        reasonCode: normalized.code,
        metadata: {
          refreshedJwks: true,
        },
      });
      throw normalized;
    }
  }
}

async function verifyWithCache(
  token: string,
  options: GuardOptions,
  jwksUrl: string,
  jwksCache: JwksCache,
  forceRefresh = false,
): Promise<ServiceIdentity> {
  let jwkSetResult: JwksCacheResult;
  try {
    jwkSetResult = await jwksCache.get(jwksUrl, forceRefresh);
  } catch (error) {
    await emitGuardEvent(options, {
      type: "jwks.refresh_failed",
      timestamp: new Date(),
      issuer: options.issuer,
      outcome: "failure",
      audience: options.audience,
      reasonCode: error instanceof AuthError ? error.code : "jwks_fetch_failed",
      metadata: {
        jwksUrl,
        forceRefresh,
      },
    });
    throw error;
  }

  if (jwkSetResult.refreshed) {
    await emitGuardEvent(options, {
      type: "jwks.refreshed",
      timestamp: new Date(),
      issuer: options.issuer,
      outcome: "success",
      audience: options.audience,
      metadata: {
        jwksUrl,
        forceRefresh,
      },
    });
  }

  const { payload } = await jwtVerify(token, jwkSetResult.jwkSet, {
    issuer: options.issuer,
    audience: options.audience,
    algorithms: ["RS256", "ES256"],
    clockTolerance: options.clockTolerance ?? DEFAULT_CLOCK_TOLERANCE_SECONDS,
  });

  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw new AuthError("invalid_token", "Token subject is missing", 401);
  }

  if (options.env && payload.env !== options.env) {
    throw new AuthError("invalid_env", "Token environment does not match", 403);
  }

  if (
    options.scopes?.length &&
    !hasRequiredScopes(getScopeClaim(payload), options.scopes)
  ) {
    throw new AuthError(
      "invalid_scope",
      "Token is missing required scopes",
      403,
    );
  }

  const client = await options.storage.findClient(payload.sub);
  if (!client?.active) {
    throw new AuthError("invalid_token", "Token client is inactive", 401);
  }

  const jti = getJti(payload);
  const revokedToken = await options.storage.findRevokedToken(jti);
  if (revokedToken && revokedToken.expiresAt > new Date()) {
    throw new AuthError("invalid_token", "Token has been revoked", 401);
  }

  if (client.tokensInvalidBefore) {
    const issuedAt = getIssuedAt(payload);
    const cutoff = Math.floor(client.tokensInvalidBefore.getTime() / 1000);
    if (issuedAt < cutoff) {
      throw new AuthError("invalid_token", "Token has been invalidated", 401);
    }
  }

  return {
    clientId: payload.sub,
    name: typeof payload.name === "string" ? payload.name : null,
    scopes: parseScopes(getScopeClaim(payload)),
    env: typeof payload.env === "string" ? payload.env : null,
    raw: payload as JWTPayload & Record<string, unknown>,
  };
}

async function emitGuardEvent(
  options: GuardOptions,
  event: GuardEvent,
): Promise<void> {
  try {
    await options.hooks?.onEvent?.(event);
  } catch {
    // Hooks are observational and must not break verification.
  }
}

function shouldRetryWithFreshJwks(error: unknown): boolean {
  return (
    error instanceof errors.JWKSNoMatchingKey ||
    error instanceof errors.JWSSignatureVerificationFailed
  );
}

function normalizeVerifyError(error: unknown): AuthError {
  if (error instanceof AuthError) {
    return error;
  }

  if (error instanceof errors.JWTClaimValidationFailed) {
    if (error.claim === "iss") {
      return new AuthError(
        "invalid_issuer",
        "Token issuer does not match",
        401,
        error,
      );
    }

    if (error.claim === "aud") {
      return new AuthError(
        "invalid_audience",
        "Token audience does not match",
        403,
        error,
      );
    }
  }

  if (
    error instanceof errors.JOSEError ||
    error instanceof errors.JWTInvalid ||
    error instanceof errors.JWTExpired
  ) {
    return new AuthError(
      "invalid_token",
      "Token verification failed",
      401,
      error,
    );
  }

  return new AuthError(
    "invalid_token",
    "Token verification failed",
    401,
    error,
  );
}

function getScopeClaim(payload: JWTPayload): string | undefined {
  return typeof payload.scope === "string" ? payload.scope : undefined;
}

function getJti(payload: JWTPayload): string {
  if (typeof payload.jti !== "string" || payload.jti.length === 0) {
    throw new AuthError("invalid_token", "Token identifier is missing", 401);
  }

  return payload.jti;
}

function getIssuedAt(payload: JWTPayload): number {
  if (typeof payload.iat !== "number") {
    throw new AuthError("invalid_token", "Token issue time is missing", 401);
  }

  return payload.iat;
}
