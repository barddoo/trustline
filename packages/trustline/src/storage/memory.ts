import { verifySecret } from "../core/crypto";
import type {
  ClientSecretRecord,
  RevokedToken,
  ServiceClient,
  SigningKey,
  StorageAdapter,
} from "./interface";

export function memoryStorage(): StorageAdapter {
  const clients = new Map<string, ServiceClient>();
  const signingKeys = new Map<string, SigningKey>();
  const revokedTokens = new Map<string, RevokedToken>();

  return {
    async findClient(clientId) {
      const client = clients.get(clientId);
      return client ? cloneClient(client) : null;
    },
    async createClient(client) {
      clients.set(client.clientId, cloneClient(client));
    },
    async deleteClient(clientId) {
      clients.delete(clientId);
    },
    async listClients() {
      return [...clients.values()].map(cloneClient);
    },
    async updateClient(clientId, updates) {
      const client = clients.get(clientId);
      if (!client) {
        return;
      }

      clients.set(
        clientId,
        cloneClient({
          ...client,
          ...updates,
        }),
      );
    },
    async touchClient(clientId, lastSeenAt) {
      const client = clients.get(clientId);
      if (!client) {
        return;
      }

      clients.set(clientId, {
        ...client,
        lastSeenAt,
      });
    },
    async setClientActive(clientId, active) {
      const client = clients.get(clientId);
      if (!client) {
        return;
      }

      clients.set(clientId, {
        ...client,
        active,
      });
    },
    async setTokensInvalidBefore(clientId, tokensInvalidBefore) {
      const client = clients.get(clientId);
      if (!client) {
        return;
      }

      clients.set(clientId, {
        ...client,
        tokensInvalidBefore,
      });
    },
    async findClientBySecret(secret) {
      for (const client of clients.values()) {
        if (await verifySecret(secret, client.currentSecretHash)) {
          return createClientSecretRecord(client, "current");
        }

        const nextSecretExpired =
          client.nextSecretExpiresAt &&
          client.nextSecretExpiresAt.getTime() <= Date.now();
        if (
          client.nextSecretHash &&
          !nextSecretExpired &&
          (await verifySecret(secret, client.nextSecretHash))
        ) {
          return createClientSecretRecord(client, "next");
        }
      }

      return null;
    },
    async getSigningKeys() {
      return [...signingKeys.values()].map(cloneSigningKey);
    },
    async addSigningKey(key) {
      signingKeys.set(key.keyId, cloneSigningKey(key));
    },
    async setSigningKeyNotAfter(keyId, notAfter) {
      const key = signingKeys.get(keyId);
      if (!key) {
        return;
      }

      signingKeys.set(keyId, {
        ...key,
        notAfter,
      });
    },
    async findRevokedToken(jti) {
      const token = revokedTokens.get(jti);
      return token ? cloneRevokedToken(token) : null;
    },
    async revokeToken(token) {
      revokedTokens.set(token.jti, cloneRevokedToken(token));
    },
  };
}

function cloneClient(client: ServiceClient): ServiceClient {
  return {
    ...client,
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
  };
}

function createClientSecretRecord(
  client: ServiceClient,
  secretKind: "current" | "next",
): ClientSecretRecord {
  return {
    clientId: client.clientId,
    secretKind,
    secretHash:
      secretKind === "current"
        ? client.currentSecretHash
        : (client.nextSecretHash as string),
    currentSecretHash: client.currentSecretHash,
    nextSecretHash: client.nextSecretHash,
    nextSecretCreatedAt: client.nextSecretCreatedAt
      ? new Date(client.nextSecretCreatedAt)
      : null,
    nextSecretExpiresAt: client.nextSecretExpiresAt
      ? new Date(client.nextSecretExpiresAt)
      : null,
  };
}

function cloneSigningKey(key: SigningKey): SigningKey {
  return {
    ...key,
    createdAt: new Date(key.createdAt),
    notBefore: new Date(key.notBefore),
    notAfter: key.notAfter ? new Date(key.notAfter) : null,
  };
}

function cloneRevokedToken(token: RevokedToken): RevokedToken {
  return {
    ...token,
    expiresAt: new Date(token.expiresAt),
  };
}
