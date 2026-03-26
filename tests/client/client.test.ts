import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { createClient } from "../../src/client";
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
});
