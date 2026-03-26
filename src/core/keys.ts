import { createPrivateKey, createPublicKey, randomUUID } from "node:crypto";

import {
  exportJWK,
  exportPKCS8,
  exportSPKI,
  generateKeyPair,
  type JWK,
} from "jose";

import type { SigningKey } from "../storage/interface";

export type SigningAlgorithm = "ES256" | "RS256";

export interface CreateSigningKeyOptions {
  algorithm?: SigningAlgorithm;
  keyId?: string;
  privateKey?: string;
}

export async function createSigningKey(
  options: CreateSigningKeyOptions = {},
): Promise<SigningKey> {
  const algorithm = options.algorithm ?? "ES256";
  const keyId = options.keyId ?? `key_${randomUUID()}`;
  const now = new Date();

  if (options.privateKey) {
    const privateKey = createPrivateKey(options.privateKey);
    const publicKey = createPublicKey(privateKey);

    return {
      keyId,
      algorithm,
      privateKey: privateKey.export({
        type: "pkcs8",
        format: "pem",
      }) as string,
      publicKey: publicKey.export({
        type: "spki",
        format: "pem",
      }) as string,
      createdAt: new Date(),
      notBefore: now,
      notAfter: null,
    };
  }

  const { privateKey, publicKey } = await generateKeyPair(algorithm, {
    extractable: true,
  });

  return {
    keyId,
    algorithm,
    privateKey: await exportPKCS8(privateKey),
    publicKey: await exportSPKI(publicKey),
    createdAt: now,
    notBefore: now,
    notAfter: null,
  };
}

export async function exportSigningKeyToJwk(
  signingKey: SigningKey,
): Promise<JWK> {
  const publicKey = createPublicKey(signingKey.publicKey);
  const jwk = await exportJWK(publicKey);

  return {
    ...jwk,
    use: "sig",
    kid: signingKey.keyId,
    alg: signingKey.algorithm,
  };
}

export function getVerificationSigningKeys(
  keys: SigningKey[],
  now = new Date(),
): SigningKey[] {
  return keys.filter((key) => key.notAfter === null || key.notAfter > now);
}

export function getSigningKeyForIssuance(
  keys: SigningKey[],
  now = new Date(),
): SigningKey | null {
  const activeKeys = keys
    .filter(
      (key) =>
        key.notBefore <= now && (key.notAfter === null || key.notAfter > now),
    )
    .sort((left, right) => right.notBefore.getTime() - left.notBefore.getTime());

  return activeKeys[0] ?? null;
}
