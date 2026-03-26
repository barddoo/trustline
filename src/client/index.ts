import { AuthError } from "../core/errors";

export interface ClientOptions {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  audience?: string;
  cache?: ClientTokenCache;
  fetch?: typeof globalThis.fetch;
  refreshSkewSeconds?: number;
}

export interface CachedClientToken {
  token: string;
  refreshAt: number;
}

export interface ClientTokenCache {
  get(key: string): Promise<CachedClientToken | null>;
  set(key: string, entry: CachedClientToken): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface TrustlineClient {
  getToken(): Promise<string>;
  getHeaders(): Promise<{ Authorization: string }>;
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

const DEFAULT_REFRESH_SKEW_SECONDS = 30;

export function createClient(options: ClientOptions): TrustlineClient {
  let inflight: Promise<string> | null = null;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const cache = options.cache ?? createMemoryTokenCache();
  const cacheKey = createCacheKey(options);

  return {
    async getToken() {
      const cachedToken = await getFreshCachedToken(cache, cacheKey);
      if (cachedToken) {
        return cachedToken.token;
      }

      if (inflight) {
        return inflight;
      }

      inflight = fetchToken(options, fetchImpl)
        .then(async (result) => {
          await cache.set(cacheKey, result);
          return result.token;
        })
        .finally(() => {
          inflight = null;
        });

      return inflight;
    },
    async getHeaders() {
      return {
        Authorization: `Bearer ${await this.getToken()}`,
      };
    },
    async fetch(input, init) {
      const headers = new Headers(init?.headers);
      headers.set("authorization", `Bearer ${await this.getToken()}`);

      return fetchImpl(input, {
        ...init,
        headers,
      });
    },
  };
}

async function fetchToken(
  options: ClientOptions,
  fetchImpl: typeof globalThis.fetch,
): Promise<CachedClientToken> {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
  });

  if (options.audience) {
    body.set("audience", options.audience);
  }

  const response = await fetchImpl(options.tokenUrl, {
    method: "POST",
    headers: {
      authorization: createBasicAuthHeader(
        options.clientId,
        options.clientSecret,
      ),
      "content-type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new AuthError(
      "invalid_token",
      `Token request failed with ${response.status}`,
      response.status,
    );
  }

  const payload = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };

  if (!payload.access_token) {
    throw new AuthError(
      "invalid_token",
      "Token response is missing access_token",
      500,
    );
  }

  const exp = getTokenExpiration(payload.access_token);
  const refreshSkewSeconds =
    options.refreshSkewSeconds ?? DEFAULT_REFRESH_SKEW_SECONDS;
  const refreshAt = exp
    ? (exp - refreshSkewSeconds) * 1000
    : Date.now() +
      Math.max((payload.expires_in ?? 60) - refreshSkewSeconds, 1) * 1000;

  return {
    token: payload.access_token,
    refreshAt,
  };
}

async function getFreshCachedToken(
  cache: ClientTokenCache,
  cacheKey: string,
): Promise<CachedClientToken | null> {
  const cachedToken = await cache.get(cacheKey);
  if (!cachedToken) {
    return null;
  }

  if (
    typeof cachedToken.token !== "string" ||
    typeof cachedToken.refreshAt !== "number"
  ) {
    await cache.delete(cacheKey);
    return null;
  }

  if (getTokenExpiration(cachedToken.token) === null) {
    await cache.delete(cacheKey);
    return null;
  }

  if (cachedToken.refreshAt <= Date.now()) {
    await cache.delete(cacheKey);
    return null;
  }

  return cachedToken;
}

function createBasicAuthHeader(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

function getTokenExpiration(token: string): number | null {
  const parts = token.split(".");
  if (parts.length < 2) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    ) as { exp?: number };
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

function createCacheKey(options: ClientOptions): string {
  return JSON.stringify({
    tokenUrl: options.tokenUrl,
    clientId: options.clientId,
    audience: options.audience ?? null,
  });
}

function createMemoryTokenCache(): ClientTokenCache {
  const cache = new Map<string, CachedClientToken>();

  return {
    async get(key) {
      return cache.get(key) ?? null;
    },
    async set(key, entry) {
      cache.set(key, entry);
    },
    async delete(key) {
      cache.delete(key);
    },
  };
}
