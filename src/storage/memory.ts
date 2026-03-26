import type {
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
    lastSeenAt: client.lastSeenAt ? new Date(client.lastSeenAt) : null,
    active: client.active,
    tokensInvalidBefore: client.tokensInvalidBefore
      ? new Date(client.tokensInvalidBefore)
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
