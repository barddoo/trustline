import { errors, type JWTPayload, jwtVerify } from "jose";

import { defaultJwksCache, type JwksCache } from "./cache";
import { AuthError } from "./errors";
import { hasRequiredScopes, parseScopes } from "./scopes";
import type { StorageAdapter } from "../storage/interface";

const DEFAULT_CLOCK_TOLERANCE_SECONDS = 5;

export interface GuardOptions {
  issuer: string;
  jwksUrl?: string;
  audience?: string | string[];
  scopes?: string[];
  env?: string;
  clockTolerance?: number;
  jwksCache?: JwksCache;
  storage: StorageAdapter;
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
    return await verifyWithCache(token, options, jwksUrl, jwksCache);
  } catch (error) {
    if (!shouldRetryWithFreshJwks(error)) {
      throw normalizeVerifyError(error);
    }

    try {
      return await verifyWithCache(token, options, jwksUrl, jwksCache, true);
    } catch (retryError) {
      throw normalizeVerifyError(retryError);
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
  const jwkSet = await jwksCache.get(jwksUrl, forceRefresh);
  const { payload } = await jwtVerify(token, jwkSet, {
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
  if (!client || !client.active) {
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
