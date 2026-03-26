import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import {
  type CachedClientToken,
  type ClientTokenCache,
  createClient,
} from "../../src/client";
import { createProvider, memoryStorage } from "../../src/index";
import { createProviderServer } from "../helpers";

describe("client", () => {
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(closers.splice(0).map((close) => close()));
  });

  it("caches tokens and deduplicates concurrent refreshes", async () => {
    const providerServer = await createProviderServer((issuer) =>
      createProvider({
        issuer,
        storage: memoryStorage(),
      }),
    );
    closers.push(() => providerServer.close());

    const created = await providerServer.provider.clients.create({
      name: "sync-job",
      scopes: ["sync:run"],
    });

    let tokenRequests = 0;
    const client = createClient({
      tokenUrl: providerServer.url("/token"),
      clientId: created.clientId,
      clientSecret: created.clientSecret,
      audience: "inventory-service",
      fetch: async (input, init) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.endsWith("/token")) {
          tokenRequests += 1;
        }
        return fetch(input, init);
      },
    });

    const [tokenA, tokenB, tokenC] = await Promise.all([
      client.getToken(),
      client.getToken(),
      client.getToken(),
    ]);

    expect(tokenA).toBe(tokenB);
    expect(tokenB).toBe(tokenC);
    expect(tokenRequests).toBe(1);
  });

  it("injects authorization headers for outgoing fetches", async () => {
    const providerServer = await createProviderServer((issuer) =>
      createProvider({
        issuer,
        storage: memoryStorage(),
      }),
    );
    closers.push(() => providerServer.close());

    const created = await providerServer.provider.clients.create({
      name: "inventory-client",
    });

    const downstream = createServer((request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          authorization: request.headers.authorization ?? null,
        }),
      );
    });

    await new Promise<void>((resolve) =>
      downstream.listen(0, "127.0.0.1", () => resolve()),
    );
    closers.push(
      () =>
        new Promise((resolve, reject) => {
          downstream.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        }),
    );

    const address = downstream.address() as AddressInfo;
    const client = createClient({
      tokenUrl: providerServer.url("/token"),
      clientId: created.clientId,
      clientSecret: created.clientSecret,
      audience: "inventory-service",
    });

    const response = await client.fetch(
      `http://127.0.0.1:${address.port}/internal`,
    );
    const payload = (await response.json()) as { authorization: string | null };

    expect(payload.authorization).toMatch(/^Bearer /);
  });

  it("reuses tokens from a shared external cache across client instances", async () => {
    const providerServer = await createProviderServer((issuer) =>
      createProvider({
        issuer,
        storage: memoryStorage(),
      }),
    );
    closers.push(() => providerServer.close());

    const created = await providerServer.provider.clients.create({
      name: "inventory-client",
    });

    let tokenRequests = 0;
    const entries = new Map<string, CachedClientToken>();
    const cache: ClientTokenCache = {
      async get(key) {
        return entries.get(key) ?? null;
      },
      async set(key, entry) {
        entries.set(key, entry);
      },
      async delete(key) {
        entries.delete(key);
      },
    };

    const fetchImpl: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/token")) {
        tokenRequests += 1;
      }
      return fetch(input, init);
    };

    const clientA = createClient({
      tokenUrl: providerServer.url("/token"),
      clientId: created.clientId,
      clientSecret: created.clientSecret,
      audience: "inventory-service",
      cache,
      fetch: fetchImpl,
    });
    const clientB = createClient({
      tokenUrl: providerServer.url("/token"),
      clientId: created.clientId,
      clientSecret: created.clientSecret,
      audience: "inventory-service",
      cache,
      fetch: fetchImpl,
    });

    const tokenA = await clientA.getToken();
    const tokenB = await clientB.getToken();

    expect(tokenA).toBe(tokenB);
    expect(tokenRequests).toBe(1);
  });

  it("evicts malformed cache entries before fetching a fresh token", async () => {
    const providerServer = await createProviderServer((issuer) =>
      createProvider({
        issuer,
        storage: memoryStorage(),
      }),
    );
    closers.push(() => providerServer.close());

    const created = await providerServer.provider.clients.create({
      name: "inventory-client",
    });

    let deleted = 0;
    const cache: ClientTokenCache = {
      async get() {
        return {
          token: "not-a-real-token",
          refreshAt: Number.NaN,
        };
      },
      async set() {},
      async delete() {
        deleted += 1;
      },
    };

    const client = createClient({
      tokenUrl: providerServer.url("/token"),
      clientId: created.clientId,
      clientSecret: created.clientSecret,
      cache,
    });

    await expect(client.getToken()).resolves.toMatch(/^[A-Za-z0-9_-]+\./);
    expect(deleted).toBe(1);
  });
});
