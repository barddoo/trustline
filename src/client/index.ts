import { AuthError } from "../core/errors";

export interface ClientOptions {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  audience?: string;
  fetch?: typeof globalThis.fetch;
  refreshSkewSeconds?: number;
}

export interface TrustlineClient {
  getToken(): Promise<string>;
  getHeaders(): Promise<{ Authorization: string }>;
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

interface CachedToken {
  token: string;
  refreshAt: number;
}

const DEFAULT_REFRESH_SKEW_SECONDS = 30;

export function createClient(options: ClientOptions): TrustlineClient {
  let cachedToken: CachedToken | null = null;
  let inflight: Promise<string> | null = null;
  const fetchImpl = options.fetch ?? globalThis.fetch;

  return {
    async getToken() {
      const now = Date.now();
      if (cachedToken && cachedToken.refreshAt > now) {
        return cachedToken.token;
      }

      if (inflight) {
        return inflight;
      }

      inflight = fetchToken(options, fetchImpl)
        .then((result) => {
          cachedToken = result;
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
): Promise<CachedToken> {
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
