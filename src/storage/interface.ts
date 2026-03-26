import type { SigningAlgorithm } from "../core/keys";

export interface ServiceClient {
  id: string;
  clientId: string;
  clientSecret: string;
  name: string;
  scopes: string[];
  createdAt: Date;
  lastSeenAt: Date | null;
  active: boolean;
  tokensInvalidBefore: Date | null;
}

export interface SigningKey {
  keyId: string;
  algorithm: SigningAlgorithm;
  privateKey: string;
  publicKey: string;
  createdAt: Date;
  notBefore: Date;
  notAfter: Date | null;
}

export interface RevokedToken {
  jti: string;
  expiresAt: Date;
}

export interface StorageAdapter {
  findClient(clientId: string): Promise<ServiceClient | null>;
  createClient(client: ServiceClient): Promise<void>;
  deleteClient(clientId: string): Promise<void>;
  listClients(): Promise<ServiceClient[]>;
  touchClient(clientId: string, lastSeenAt: Date): Promise<void>;
  setClientActive(clientId: string, active: boolean): Promise<void>;
  setTokensInvalidBefore(clientId: string, at: Date | null): Promise<void>;
  getSigningKeys(): Promise<SigningKey[]>;
  addSigningKey(key: SigningKey): Promise<void>;
  setSigningKeyNotAfter(keyId: string, notAfter: Date | null): Promise<void>;
  findRevokedToken(jti: string): Promise<RevokedToken | null>;
  revokeToken(token: RevokedToken): Promise<void>;
}

export interface SqlStorageOptions {
  tablePrefix?: string;
  tables?: {
    clients?: string;
    signingKeys?: string;
    revokedTokens?: string;
  };
}
