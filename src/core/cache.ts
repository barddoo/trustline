import {
  createLocalJWKSet,
  type JSONWebKeySet,
  type JWTVerifyGetKey,
} from "jose";

import { AuthError } from "./errors";

interface CacheEntry {
  expiresAt: number;
  jwks: JSONWebKeySet;
  jwkSet: JWTVerifyGetKey;
}

interface FetchState {
  promise: Promise<CacheEntry>;
}

export interface JwksCacheOptions {
  ttlMs?: number;
}

export class JwksCache {
  private readonly ttlMs: number;
  private readonly entries = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, FetchState>();

  constructor(options: JwksCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? 10 * 60 * 1000;
  }

  async get(url: string, forceRefresh = false): Promise<JWTVerifyGetKey> {
    const now = Date.now();
    const cached = this.entries.get(url);

    if (!forceRefresh && cached && cached.expiresAt > now) {
      return cached.jwkSet;
    }

    const inflight = this.inflight.get(url);
    if (inflight) {
      const entry = await inflight.promise;
      return entry.jwkSet;
    }

    const promise = this.fetchAndCache(url);
    this.inflight.set(url, { promise });

    try {
      const entry = await promise;
      return entry.jwkSet;
    } finally {
      this.inflight.delete(url);
    }
  }

  clear(url?: string): void {
    if (url) {
      this.entries.delete(url);
      this.inflight.delete(url);
      return;
    }

    this.entries.clear();
    this.inflight.clear();
  }

  private async fetchAndCache(url: string): Promise<CacheEntry> {
    let response: Response;

    try {
      response = await fetch(url);
    } catch (error) {
      throw new AuthError(
        "jwks_fetch_failed",
        `Failed to fetch JWKS from ${url}`,
        401,
        error,
      );
    }

    if (!response.ok) {
      throw new AuthError(
        "jwks_fetch_failed",
        `Failed to fetch JWKS from ${url}`,
        401,
      );
    }

    const json = (await response.json()) as JSONWebKeySet;
    if (!json || !Array.isArray(json.keys)) {
      throw new AuthError(
        "jwks_fetch_failed",
        `Invalid JWKS payload from ${url}`,
        401,
      );
    }

    const entry: CacheEntry = {
      jwks: json,
      jwkSet: createLocalJWKSet(json),
      expiresAt: Date.now() + this.ttlMs,
    };

    this.entries.set(url, entry);

    return entry;
  }
}

export const defaultJwksCache = new JwksCache();
