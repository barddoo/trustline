import type { SigningAlgorithm } from "../core/keys";

export interface ServiceClient {
  id: string;
  clientId: string;
  clientSecret: string;
  name: string;
  scopes: string[];
  createdAt: Date;
  lastSeenAt: Date | null;
}

export interface SigningKey {
  keyId: string;
  algorithm: SigningAlgorithm;
  privateKey: string;
  publicKey: string;
  createdAt: Date;
  retiredAt: Date | null;
}

export interface StorageAdapter {
  findClient(clientId: string): Promise<ServiceClient | null>;
  createClient(client: ServiceClient): Promise<void>;
  deleteClient(clientId: string): Promise<void>;
  listClients(): Promise<ServiceClient[]>;
  touchClient(clientId: string, lastSeenAt: Date): Promise<void>;
  getSigningKeys(): Promise<SigningKey[]>;
  addSigningKey(key: SigningKey): Promise<void>;
  retireKey(keyId: string): Promise<void>;
}
