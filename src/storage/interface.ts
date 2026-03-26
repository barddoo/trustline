import type { SigningAlgorithm } from "../core/keys";

export interface ServiceClient {
  id: string;
  clientId: string;
  name: string;
  scopes: string[];
  createdAt: Date;
  updatedAt: Date;
  lastSeenAt: Date | null;
  currentSecretHash: string;
  currentSecretCreatedAt: Date;
  currentSecretLastUsedAt: Date | null;
  nextSecretHash: string | null;
  nextSecretCreatedAt: Date | null;
  nextSecretExpiresAt: Date | null;
  nextSecretLastUsedAt: Date | null;
  secretLastRotatedAt: Date | null;
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

export interface ClientSecretRecord {
  clientId: string;
  secretKind: "current" | "next";
  secretHash: string;
  currentSecretHash: string;
  nextSecretHash: string | null;
  nextSecretCreatedAt: Date | null;
  nextSecretExpiresAt: Date | null;
}

export interface StorageAdapter {
  findClient(clientId: string): Promise<ServiceClient | null>;
  createClient(client: ServiceClient): Promise<void>;
  deleteClient(clientId: string): Promise<void>;
  listClients(): Promise<ServiceClient[]>;
  updateClient(
    clientId: string,
    updates: Partial<
      Pick<
        ServiceClient,
        | "name"
        | "scopes"
        | "updatedAt"
        | "currentSecretHash"
        | "currentSecretCreatedAt"
        | "currentSecretLastUsedAt"
        | "nextSecretHash"
        | "nextSecretCreatedAt"
        | "nextSecretExpiresAt"
        | "nextSecretLastUsedAt"
        | "secretLastRotatedAt"
        | "lastSeenAt"
        | "active"
        | "tokensInvalidBefore"
      >
    >,
  ): Promise<void>;
  touchClient(clientId: string, lastSeenAt: Date): Promise<void>;
  setClientActive(clientId: string, active: boolean): Promise<void>;
  setTokensInvalidBefore(clientId: string, at: Date | null): Promise<void>;
  findClientBySecret(secret: string): Promise<ClientSecretRecord | null>;
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
