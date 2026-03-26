import type { ServiceClient, SigningKey, StorageAdapter } from "./interface";

export function memoryStorage(): StorageAdapter {
  const clients = new Map<string, ServiceClient>();
  const signingKeys = new Map<string, SigningKey>();

  return {
    async findClient(clientId) {
      return clients.get(clientId) ?? null;
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
    async getSigningKeys() {
      return [...signingKeys.values()].map(cloneSigningKey);
    },
    async addSigningKey(key) {
      signingKeys.set(key.keyId, cloneSigningKey(key));
    },
    async retireKey(keyId) {
      const key = signingKeys.get(keyId);
      if (!key) {
        return;
      }

      signingKeys.set(keyId, {
        ...key,
        retiredAt: new Date(),
      });
    },
  };
}

function cloneClient(client: ServiceClient): ServiceClient {
  return {
    ...client,
    scopes: [...client.scopes],
    createdAt: new Date(client.createdAt),
    lastSeenAt: client.lastSeenAt ? new Date(client.lastSeenAt) : null,
  };
}

function cloneSigningKey(key: SigningKey): SigningKey {
  return {
    ...key,
    createdAt: new Date(key.createdAt),
    retiredAt: key.retiredAt ? new Date(key.retiredAt) : null,
  };
}
